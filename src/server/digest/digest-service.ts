import { and, count, desc, eq, inArray, lte, sql, type SQL } from 'drizzle-orm'
import {
  DIGEST_FEED_ITEMS,
  type Digest,
  type DigestCalendar,
  type DigestDay,
  type DigestFeeds,
  type DigestFilter,
  type DigestGroup,
  type DigestItem,
  type FeedItemRow,
  type SubscriptionSummary,
} from '../../shared/api.js'
import { rhythmOf, type Rhythm } from '../../shared/rhythm.js'
import type { Clock } from '../clock.js'
import type { DrizzleDatabase } from '../persistence/database.js'
import type { InstallationSettingsStore } from '../persistence/installation-settings.js'
import { effectiveFeedTitle, feedItems, feeds, libraryItems, subscriptions } from '../persistence/schema.js'
import { gridDayKeys, stripCadenceByFeed } from './cadence-window.js'
import {
  chronologyTime,
  dateKey,
  dayAfter,
  dayBefore,
  dayStartUtc,
  inDigestOrder,
  longDate,
  timeLabel,
} from './chronology.js'
import { beyondCursorSql, chronologySql, LIST_PAGE_SIZE, nextListCursor, type ListCursor } from './list-page.js'

export class DigestService {
  readonly #db: DrizzleDatabase
  readonly #clock: Clock
  readonly #settings: InstallationSettingsStore

  constructor(options: { db: DrizzleDatabase; clock: Clock; settings: InstallationSettingsStore }) {
    this.#db = options.db
    this.#clock = options.clock
    this.#settings = options.settings
  }

  /** One page of the Digest under `filter`, each day's group counted in full. */
  read(filter: DigestFilter, cursor?: ListCursor): Digest {
    const timezone = this.#settings.effectiveTimezone()
    const now = this.#clock.now()
    const chronology = chronologySql(now)
    const narrowing = this.#narrowing(filter, now, timezone)

    const fetched = this.#db
      .select(DIGEST_ROW_COLUMNS)
      .from(feedItems)
      .innerJoin(feeds, eq(feeds.id, feedItems.feedId))
      .innerJoin(subscriptions, eq(subscriptions.feedId, feeds.id))
      .leftJoin(libraryItems, eq(libraryItems.feedItemId, feedItems.id))
      .where(and(cursor ? beyondCursorSql(chronology, cursor) : undefined, ...narrowing))
      .orderBy(sql`${chronology} DESC`, desc(feedItems.id))
      .limit(LIST_PAGE_SIZE + 1)
      .all()

    const rows = inDigestOrder(fetched.slice(0, LIST_PAGE_SIZE), now)

    const today = dateKey(now, timezone)
    const yesterday = dayBefore(today)
    const groups = new Map<string, DigestGroup>()

    for (const { row, chronology } of rows) {
      const instant = new Date(chronology)
      const date = dateKey(instant, timezone)
      let group = groups.get(date)
      if (!group) {
        group = {
          date,
          label: date === today ? 'Today' : date === yesterday ? 'Yesterday' : longDate(instant, today, timezone),
          count: 0,
          items: [],
        }
        groups.set(date, group)
      }

      group.items.push(digestItemOf(row, instant, timezone))
    }

    const dates = [...groups.keys()]
    const newest = dates[0]
    const oldest = dates.at(-1)
    const counts =
      newest && oldest ? this.#countsByDay(narrowing, oldest, newest, now, timezone) : new Map<string, number>()

    return {
      today,
      groups: [...groups.values()].map((group) => ({ ...group, count: counts.get(group.date) ?? 0 })),
      nextCursor: nextListCursor(fetched.length, rows.at(-1)),
    }
  }

  /** Every day of the cadence grid window, counted across the whole Digest, and the Subscriptions feeding it. */
  calendar(): DigestCalendar {
    const timezone = this.#settings.effectiveTimezone()
    const now = this.#clock.now()
    const today = dateKey(now, timezone)
    const days = gridDayKeys(today)
    const counts = this.#countsByDay([], days[0] ?? today, today, now, timezone)
    const subscribed = this.#db.select({ count: count() }).from(subscriptions).get()?.count ?? 0
    return { today, days: days.map((date) => ({ date, count: counts.get(date) ?? 0 })), subscriptions: subscribed }
  }

  /** The Feeds that published on `date`, busiest first, then by title. */
  day(date: string): DigestDay {
    const timezone = this.#settings.effectiveTimezone()
    const now = this.#clock.now()
    const published = count()
    const counted = this.#db
      .select({ feedId: feeds.id, title: effectiveFeedTitle, count: published })
      .from(feedItems)
      .innerJoin(feeds, eq(feeds.id, feedItems.feedId))
      .innerJoin(subscriptions, eq(subscriptions.feedId, feeds.id))
      .where(and(...this.#narrowing({ day: date }, now, timezone)))
      .groupBy(feeds.id)
      .orderBy(desc(published), effectiveFeedTitle)
      .all()
    return { date, feeds: counted }
  }

  /** Each of `subscribed` with its newest items, the most recently published Feed first. */
  byFeed(subscribed: readonly SubscriptionSummary[]): DigestFeeds {
    const timezone = this.#settings.effectiveTimezone()
    const now = this.#clock.now()
    const chronology = chronologySql(now)

    const ranked = this.#db
      .select({
        feedItemId: feedItems.id,
        feedId: feedItems.feedId,
        title: feedItems.title,
        link: feedItems.link,
        publishedAt: feedItems.publishedAt,
        firstSeenAt: feedItems.firstSeenAt,
        savedAt: libraryItems.savedAt,
        rank: sql<number>`ROW_NUMBER() OVER (PARTITION BY ${feedItems.feedId} ORDER BY ${chronology} DESC, ${feedItems.id} DESC)`.as(
          'rank',
        ),
      })
      .from(feedItems)
      .innerJoin(subscriptions, eq(subscriptions.feedId, feedItems.feedId))
      .leftJoin(libraryItems, eq(libraryItems.feedItemId, feedItems.id))
      .as('ranked')
    const newest = this.#db.select().from(ranked).where(lte(ranked.rank, DIGEST_FEED_ITEMS)).all()

    const itemsByFeed = Map.groupBy(inDigestOrder(newest, now), ({ row }) => row.feedId)
    const latest = (feed: SubscriptionSummary) => {
      const first = itemsByFeed.get(feed.feedId)?.[0]
      return first ? first.chronology : Number.NEGATIVE_INFINITY
    }

    return {
      today: dateKey(now, timezone),
      feeds: subscribed
        .toSorted((left, right) => latest(right) - latest(left))
        .map((feed) => ({
          ...feed,
          items: (itemsByFeed.get(feed.feedId) ?? []).map(({ row, chronology }) =>
            feedItemRowOf(row, new Date(chronology), timezone),
          ),
        })),
    }
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

  /** The filter as WHERE conditions over `feedItems`, joined to current Subscriptions. */
  #narrowing({ rhythm, day, feeds: feedIds = [] }: DigestFilter, now: Date, timezone: string): SQL[] {
    const conditions: SQL[] = []
    if (rhythm) conditions.push(inArray(feedItems.feedId, this.#feedsOfRhythm(rhythm, now, timezone)))
    if (day) conditions.push(this.#withinDays(day, day, now, timezone))
    if (feedIds.length > 0) conditions.push(inArray(feedItems.feedId, [...feedIds]))
    return conditions
  }

  #feedsOfRhythm(rhythm: Rhythm, now: Date, timezone: string): number[] {
    const feedIds = this.#db
      .select({ feedId: subscriptions.feedId })
      .from(subscriptions)
      .all()
      .map(({ feedId }) => feedId)
    const cadenceOf = stripCadenceByFeed(this.#db, timezone, now, feedIds)
    return feedIds.filter((feedId) => rhythmOf(cadenceOf(feedId)) === rhythm)
  }

  /** From the start of `first` to the end of `last`, both installation-timezone days. */
  #withinDays(first: string, last: string, now: Date, timezone: string): SQL {
    const chronology = chronologySql(now)
    const start = dayStartUtc(first, timezone).toISOString()
    const end = dayStartUtc(dayAfter(last), timezone).toISOString()
    return sql`${chronology} >= ${start} AND ${chronology} < ${end}`
  }

  #countsByDay(narrowing: readonly SQL[], first: string, last: string, now: Date, timezone: string) {
    const rows = this.#db
      .select({ publishedAt: feedItems.publishedAt, firstSeenAt: feedItems.firstSeenAt })
      .from(feedItems)
      .innerJoin(subscriptions, eq(subscriptions.feedId, feedItems.feedId))
      .where(and(...narrowing, this.#withinDays(first, last, now, timezone)))
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
