import { and, count, desc, eq, inArray, sql, type SQL } from 'drizzle-orm'
import {
  CADENCE_STRIP_DAYS,
  QUIET_SPELL_DAYS,
  type Digest,
  type DigestCalendar,
  type DigestFilter,
  type DigestGroup,
  type DigestItem,
  type DigestReturn,
  type FeedItemRow,
} from '../../shared/api.js'
import type { Clock } from '../clock.js'
import type { DrizzleDatabase } from '../persistence/database.js'
import type { InstallationSettingsStore } from '../persistence/installation-settings.js'
import { effectiveFeedTitle, feedItems, feeds, libraryItems, subscriptions } from '../persistence/schema.js'
import { gridDayKeys, trailingDayKeys } from './cadence-window.js'
import {
  chronologyTime,
  dateKey,
  dayAfter,
  dayBefore,
  daysBetween,
  dayStartUtc,
  inDigestOrder,
  longDate,
  timeLabel,
} from './chronology.js'
import { beyondCursorSql, chronologySql, LIST_PAGE_SIZE, type ListCursor } from './list-page.js'

export class DigestService {
  readonly #db: DrizzleDatabase
  readonly #clock: Clock
  readonly #settings: InstallationSettingsStore

  constructor(options: { db: DrizzleDatabase; clock: Clock; settings: InstallationSettingsStore }) {
    this.#db = options.db
    this.#clock = options.clock
    this.#settings = options.settings
  }

  /**
   * One page of the Digest `from` a day, or from today: whole days, newest
   * first, as many as it takes to reach `LIST_PAGE_SIZE` items. A busy day
   * comes whole however long it runs, so no Feed's day is split across pages.
   */
  read({ from }: DigestFilter): Digest {
    const timezone = this.#settings.effectiveTimezone()
    const now = this.#clock.now()
    const chronology = chronologySql(now)
    const before = from ? sql`${chronology} < ${dayStartUtc(dayAfter(from), timezone).toISOString()}` : undefined
    const dayOf = (row: DigestRow) => dateKey(new Date(chronologyTime(row.publishedAt, row.firstSeenAt, now)), timezone)

    const head = this.#newestFirst(now, before).limit(LIST_PAGE_SIZE).all()
    const last = head.at(-1)
    let fetched = head
    let nextFrom: string | null = null
    if (last && head.length === LIST_PAGE_SIZE) {
      const opening = dayStartUtc(dayOf(last), timezone).toISOString()
      fetched = this.#newestFirst(now, before, sql`${chronology} >= ${opening}`).all()
      const older = this.#newestFirst(now, sql`${chronology} < ${opening}`).limit(1).get()
      nextFrom = older ? dayOf(older) : null
    }

    const today = dateKey(now, timezone)
    const yesterday = dayBefore(today)
    const groups = new Map<string, Omit<DigestGroup, 'returns'>>()
    for (const { row, chronology } of inDigestOrder(fetched, now)) {
      const instant = new Date(chronology)
      const date = dateKey(instant, timezone)
      let group = groups.get(date)
      if (!group) {
        const label = date === today ? 'Today' : date === yesterday ? 'Yesterday' : longDate(instant, today, timezone)
        group = { date, label, items: [] }
        groups.set(date, group)
      }
      group.items.push(digestItemOf(row, instant, timezone))
    }

    const returnsOn = this.#returns([...groups.values()], now, timezone)
    return {
      today,
      groups: [...groups.values()].map((group) => ({ ...group, returns: returnsOn(group) })),
      nextFrom,
    }
  }

  /** Every day of the cadence grid window, counted across the whole Digest, and the Subscriptions feeding it. */
  calendar(): DigestCalendar {
    const timezone = this.#settings.effectiveTimezone()
    const now = this.#clock.now()
    const today = dateKey(now, timezone)
    const days = gridDayKeys(today)
    const counts = this.#countsByDay(days[0] ?? today, today, now, timezone)
    const subscribed = this.#db.select({ count: count() }).from(subscriptions).get()?.count ?? 0
    return { today, days: days.map((date) => ({ date, count: counts.get(date) ?? 0 })), subscriptions: subscribed }
  }

  /**
   * The Feed Item after this one in Digest order — answered here so the Reader and
   * the Digest can never disagree. `undefined` when the item is last, or not in the Digest.
   */
  after(feedItemId: number): DigestItem | undefined {
    const timezone = this.#settings.effectiveTimezone()
    const now = this.#clock.now()

    const current = this.#db
      .select({ publishedAt: feedItems.publishedAt, firstSeenAt: feedItems.firstSeenAt })
      .from(feedItems)
      .innerJoin(subscriptions, eq(subscriptions.feedId, feedItems.feedId))
      .where(eq(feedItems.id, feedItemId))
      .limit(1)
      .all()[0]
    if (!current) return undefined

    const chronology = chronologySql(now)
    const cursor: ListCursor = {
      instant: new Date(chronologyTime(current.publishedAt, current.firstSeenAt, now)).toISOString(),
      feedItemId,
    }
    const next = this.#db
      .select(DIGEST_ROW_COLUMNS)
      .from(feedItems)
      .innerJoin(feeds, eq(feeds.id, feedItems.feedId))
      .innerJoin(subscriptions, eq(subscriptions.feedId, feeds.id))
      .leftJoin(libraryItems, eq(libraryItems.feedItemId, feedItems.id))
      .where(beyondCursorSql(chronology, cursor))
      .orderBy(sql`${chronology} DESC`, desc(feedItems.id))
      .limit(1)
      .all()[0]
    if (!next) return undefined

    const instant = new Date(chronologyTime(next.publishedAt, next.firstSeenAt, now))
    return digestItemOf(next, instant, timezone)
  }

  /** Digest rows under `conditions`, newest first along the chronology. */
  #newestFirst(now: Date, ...conditions: (SQL | undefined)[]) {
    return this.#db
      .select(DIGEST_ROW_COLUMNS)
      .from(feedItems)
      .innerJoin(feeds, eq(feeds.id, feedItems.feedId))
      .innerJoin(subscriptions, eq(subscriptions.feedId, feeds.id))
      .leftJoin(libraryItems, eq(libraryItems.feedItemId, feedItems.id))
      .where(and(...conditions))
      .orderBy(sql`${chronologySql(now)} DESC`, desc(feedItems.id))
  }

  /**
   * For each day, its Feeds back from a quiet spell: read from every retained
   * item of the page's Feeds up to the page's newest day, so a spell that
   * began before the page is still seen whole.
   */
  #returns(groups: readonly Pick<DigestGroup, 'date' | 'items'>[], now: Date, timezone: string) {
    const newest = groups[0]?.date
    const feedIds = [...new Set(groups.flatMap((group) => group.items.map((item) => item.feedId)))]
    const daysByFeed = new Map<number, Map<string, number>>()
    if (newest) {
      const rows = this.#db
        .select({ feedId: feedItems.feedId, publishedAt: feedItems.publishedAt, firstSeenAt: feedItems.firstSeenAt })
        .from(feedItems)
        .where(
          and(
            inArray(feedItems.feedId, feedIds),
            sql`${chronologySql(now)} < ${dayStartUtc(dayAfter(newest), timezone).toISOString()}`,
          ),
        )
        .all()
      for (const row of rows) {
        const date = dateKey(new Date(chronologyTime(row.publishedAt, row.firstSeenAt, now)), timezone)
        const days = daysByFeed.get(row.feedId) ?? new Map<string, number>()
        days.set(date, (days.get(date) ?? 0) + 1)
        daysByFeed.set(row.feedId, days)
      }
    }

    return ({ date, items }: Pick<DigestGroup, 'date' | 'items'>): DigestReturn[] =>
      [...new Set(items.map((item) => item.feedId))].flatMap((feedId) => {
        const days = daysByFeed.get(feedId) ?? new Map<string, number>()
        const previous = [...days.keys()]
          .filter((day) => day < date)
          .sort()
          .at(-1)
        if (!previous) return []
        const quietDays = daysBetween(date, previous)
        if (quietDays < QUIET_SPELL_DAYS) return []
        const cadence = trailingDayKeys(date, CADENCE_STRIP_DAYS).map((day) => days.get(day) ?? 0)
        return [{ feedId, quietDays, cadence }]
      })
  }

  /** From the start of `first` to the end of `last`, both installation-timezone days. */
  #withinDays(first: string, last: string, now: Date, timezone: string): SQL {
    const chronology = chronologySql(now)
    const start = dayStartUtc(first, timezone).toISOString()
    const end = dayStartUtc(dayAfter(last), timezone).toISOString()
    return sql`${chronology} >= ${start} AND ${chronology} < ${end}`
  }

  #countsByDay(first: string, last: string, now: Date, timezone: string) {
    const rows = this.#db
      .select({ publishedAt: feedItems.publishedAt, firstSeenAt: feedItems.firstSeenAt })
      .from(feedItems)
      .innerJoin(subscriptions, eq(subscriptions.feedId, feedItems.feedId))
      .where(this.#withinDays(first, last, now, timezone))
      .all()
    const counts = new Map<string, number>()
    for (const row of rows) {
      const date = dateKey(new Date(chronologyTime(row.publishedAt, row.firstSeenAt, now)), timezone)
      counts.set(date, (counts.get(date) ?? 0) + 1)
    }
    return counts
  }
}

const DIGEST_ROW_COLUMNS = {
  feedItemId: feedItems.id,
  title: feedItems.title,
  feedId: feeds.id,
  feedTitle: effectiveFeedTitle,
  link: feedItems.link,
  publishedAt: feedItems.publishedAt,
  imageUrl: feedItems.imageUrl,
  summary: feedItems.summary,
  firstSeenAt: feedItems.firstSeenAt,
  savedAt: libraryItems.savedAt,
}

interface DigestRow {
  readonly feedItemId: number
  readonly title: string | null
  readonly feedId: number
  readonly feedTitle: string
  readonly link: string | null
  readonly publishedAt: string | null
  readonly imageUrl: string | null
  readonly summary: string | null
  readonly firstSeenAt: string
  readonly savedAt: string | null
}

function digestItemOf(row: DigestRow, instant: Date, timezone: string): DigestItem {
  return {
    feedItemId: row.feedItemId,
    title: row.title ?? 'Untitled',
    feedId: row.feedId,
    feedTitle: row.feedTitle,
    link: row.link,
    publishedAt: row.publishedAt,
    displayTime: timeLabel(instant, timezone),
    imageUrl: row.imageUrl === null ? null : `/api/items/${row.feedItemId}/image`,
    summary: row.summary,
    firstSeenAt: row.firstSeenAt,
    saved: row.savedAt !== null,
  }
}

/** A Feed Item as its own Feed lists it, placed on its chronology day. */
export function feedItemRowOf(
  row: Pick<DigestRow, 'feedItemId' | 'title' | 'link' | 'publishedAt' | 'firstSeenAt' | 'savedAt'>,
  instant: Date,
  timezone: string,
): FeedItemRow {
  return {
    feedItemId: row.feedItemId,
    title: row.title ?? 'Untitled',
    link: row.link,
    publishedAt: row.publishedAt,
    firstSeenAt: row.firstSeenAt,
    date: dateKey(instant, timezone),
    displayTime: timeLabel(instant, timezone),
    saved: row.savedAt !== null,
  }
}
