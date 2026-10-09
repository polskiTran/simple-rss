import { and, count, desc, eq, gte, lt, max, or, type SQL } from 'drizzle-orm'
import {
  CADENCE_STRIP_DAYS,
  QUIET_SPELL_DAYS,
  type Digest,
  type DigestCalendar,
  type DigestStart,
  type DigestGroup,
  type DigestItem,
  type DigestReturn,
} from '../../shared/api.js'
import type { Clock } from '../clock.js'
import type { DrizzleDatabase } from '../persistence/database.js'
import type { InstallationSettingsStore } from '../persistence/installation-settings.js'
import { LISTED_ITEM_COLUMNS, listedItemOf, type ListedItemRow } from '../persistence/listed-item.js'
import { effectiveFeedTitle, feedItems, feeds, libraryItems, subscriptions } from '../persistence/schema.js'
import { cadenceByFeed, dailyCounts, gridDayKeys, trailingDayKeys } from './cadence-window.js'
import { dateKey, dayAfter, dayBefore, dayKeysIn, daysBetween, dayStartUtc, longDate, timeLabel } from '../calendar.js'

/** Items a Digest page reaches before completing the day the last one falls on (ADR 0011). */
const DIGEST_PAGE_SIZE = 50

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
   * first, as many as it takes to reach `DIGEST_PAGE_SIZE` items. A busy day
   * comes whole however long it runs, so no Feed's day is split across pages.
   */
  read({ from }: DigestStart): Digest {
    const timezone = this.#settings.effectiveTimezone()
    const dayOf = dayKeysIn(timezone)
    const before = from ? lt(feedItems.chronologyAt, dayStartUtc(dayAfter(from), timezone).toISOString()) : undefined

    const head = this.#newestFirst(before).limit(DIGEST_PAGE_SIZE).all()
    const last = head.at(-1)
    let fetched = head
    let nextFrom: string | null = null
    if (last && head.length === DIGEST_PAGE_SIZE) {
      const opening = dayStartUtc(dayOf(last.chronologyAt), timezone).toISOString()
      fetched = this.#newestFirst(before, gte(feedItems.chronologyAt, opening)).all()
      const older = this.#newestFirst(lt(feedItems.chronologyAt, opening)).limit(1).get()
      nextFrom = older ? dayOf(older.chronologyAt) : null
    }

    const today = dateKey(this.#clock.now(), timezone)
    const yesterday = dayBefore(today)
    const groups = new Map<string, Omit<DigestGroup, 'returns'>>()
    for (const row of fetched) {
      const date = dayOf(row.chronologyAt)
      let group = groups.get(date)
      if (!group) {
        const label =
          date === today
            ? 'Today'
            : date === yesterday
              ? 'Yesterday'
              : longDate(new Date(row.chronologyAt), today, timezone)
        group = { date, label, items: [] }
        groups.set(date, group)
      }
      group.items.push(digestItemOf(row, timezone))
    }

    return {
      today,
      groups: [...groups.values()].map((group) => ({ ...group, returns: this.#returns(group, timezone, dayOf) })),
      nextFrom,
    }
  }

  /** Every day of the cadence grid window, counted across the whole Digest, and the Subscriptions feeding it. */
  calendar(): DigestCalendar {
    const timezone = this.#settings.effectiveTimezone()
    const today = dateKey(this.#clock.now(), timezone)
    const days = gridDayKeys(today)
    const countOn = dailyCounts(this.#db, timezone, days)
    const subscribed = this.#db.select({ count: count() }).from(subscriptions).get()?.count ?? 0
    return { today, days: days.map((date) => ({ date, count: countOn(date) })), subscriptions: subscribed }
  }

  /**
   * The Feed Item after this one in Digest order — answered here so the Reader and
   * the Digest can never disagree. `undefined` when the item is last, or not in the Digest.
   */
  after(feedItemId: number): DigestItem | undefined {
    const current = this.#db
      .select({ chronologyAt: feedItems.chronologyAt })
      .from(feedItems)
      .innerJoin(subscriptions, eq(subscriptions.feedId, feedItems.feedId))
      .where(eq(feedItems.id, feedItemId))
      .limit(1)
      .all()[0]
    if (!current) return undefined

    const { chronologyAt } = current
    const next = this.#newestFirst(
      or(
        lt(feedItems.chronologyAt, chronologyAt),
        and(eq(feedItems.chronologyAt, chronologyAt), lt(feedItems.id, feedItemId)),
      ),
    )
      .limit(1)
      .all()[0]
    return next && digestItemOf(next, this.#settings.effectiveTimezone())
  }

  /** Digest rows under `conditions`, newest first along the chronology index. */
  #newestFirst(...conditions: (SQL | undefined)[]) {
    return this.#db
      .select(DIGEST_ROW_COLUMNS)
      .from(feedItems)
      .innerJoin(feeds, eq(feeds.id, feedItems.feedId))
      .innerJoin(subscriptions, eq(subscriptions.feedId, feeds.id))
      .leftJoin(libraryItems, eq(libraryItems.feedItemId, feedItems.id))
      .where(and(...conditions))
      .orderBy(desc(feedItems.chronologyAt), desc(feedItems.id))
  }

  /**
   * The day's Feeds back from a quiet spell: each Feed's previous item before
   * the day is one lookup along its own chronology, so a spell that began before
   * the page is still seen whole. Only a returning Feed has its Cadence counted.
   */
  #returns(
    { date, items }: Pick<DigestGroup, 'date' | 'items'>,
    timezone: string,
    dayOf: (instant: string) => string,
  ): DigestReturn[] {
    const opening = dayStartUtc(date, timezone).toISOString()
    return [...new Set(items.map((item) => item.feedId))].flatMap((feedId) => {
      const previous = this.#db
        .select({ at: max(feedItems.chronologyAt) })
        .from(feedItems)
        .where(and(eq(feedItems.feedId, feedId), lt(feedItems.chronologyAt, opening)))
        .get()?.at
      if (!previous) return []
      const quietDays = daysBetween(date, dayOf(previous))
      if (quietDays < QUIET_SPELL_DAYS) return []
      const cadence = cadenceByFeed(this.#db, timezone, trailingDayKeys(date, CADENCE_STRIP_DAYS), [feedId])(feedId)
      return [{ feedId, quietDays, cadence }]
    })
  }
}

const DIGEST_ROW_COLUMNS = {
  ...LISTED_ITEM_COLUMNS,
  feedId: feeds.id,
  feedTitle: effectiveFeedTitle,
  link: feedItems.link,
  imageUrl: feedItems.imageUrl,
  summary: feedItems.summary,
}

interface DigestRow extends ListedItemRow {
  readonly feedId: number
  readonly feedTitle: string
  readonly link: string | null
  readonly imageUrl: string | null
  readonly summary: string | null
}

function digestItemOf(row: DigestRow, timezone: string): DigestItem {
  return {
    ...listedItemOf(row),
    feedId: row.feedId,
    feedTitle: row.feedTitle,
    link: row.link,
    displayTime: timeLabel(new Date(row.chronologyAt), timezone),
    imageUrl: row.imageUrl === null ? null : `/api/items/${row.feedItemId}/image`,
    summary: row.summary,
  }
}
