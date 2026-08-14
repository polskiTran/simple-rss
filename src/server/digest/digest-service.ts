import { desc, eq, sql, type SQL } from 'drizzle-orm'
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import type { Digest, DigestItem } from '../../shared/api.js'
import type { Clock } from '../clock.js'
import type { SqliteDatabase } from '../persistence/database.js'
import type { InstallationSettingsStore } from '../persistence/installation-settings.js'
import { feedItems, feeds, libraryItems, subscriptions } from '../persistence/schema.js'
import { chronologyTime, dateKey, dayAfter, dayBefore, dayStartUtc, inDigestOrder, timeLabel } from './chronology.js'
import { beyondCursorSql, chronologySql, LIST_PAGE_SIZE, nextListCursor, type ListCursor } from './list-page.js'

export class DigestService {
  readonly #db: BetterSQLite3Database
  readonly #clock: Clock
  readonly #settings: InstallationSettingsStore

  constructor(options: { database: SqliteDatabase; clock: Clock; settings: InstallationSettingsStore }) {
    this.#db = drizzle(options.database)
    this.#clock = options.clock
    this.#settings = options.settings
  }

  read(cursor?: ListCursor): Digest {
    const timezone = this.#settings.effectiveTimezone()
    const now = this.#clock.now()
    const chronology = chronologySql(now)

    const fetched = this.#db
      .select({
        feedItemId: feedItems.id,
        title: feedItems.title,
        feedId: feeds.id,
        feedTitle: feeds.title,
        link: feedItems.link,
        publishedAt: feedItems.publishedAt,
        imageUrl: feedItems.imageUrl,
        summary: feedItems.summary,
        firstSeenAt: feedItems.firstSeenAt,
        savedAt: libraryItems.savedAt,
      })
      .from(feedItems)
      .innerJoin(feeds, eq(feeds.id, feedItems.feedId))
      .innerJoin(subscriptions, eq(subscriptions.feedId, feeds.id))
      .leftJoin(libraryItems, eq(libraryItems.feedItemId, feedItems.id))
      .where(cursor ? beyondCursorSql(chronology, cursor) : undefined)
      .orderBy(sql`${chronology} DESC`, desc(feedItems.id))
      .limit(LIST_PAGE_SIZE + 1)
      .all()

    const rows = inDigestOrder(fetched.slice(0, LIST_PAGE_SIZE), now)

    const today = dateKey(now, timezone)
    const yesterday = dayBefore(today)
    const groups = new Map<string, { date: string; label: string; items: DigestItem[] }>()

    for (const { row, chronology } of rows) {
      const instant = new Date(chronology)
      const date = dateKey(instant, timezone)
      let group = groups.get(date)
      if (!group) {
        group = {
          date,
          label: date === today ? 'today' : date === yesterday ? 'yesterday' : calendarLabel(instant, timezone),
          items: [],
        }
        groups.set(date, group)
      }

      group.items.push(digestItemOf(row, instant, timezone))
    }

    return {
      today: { date: today, volume: this.#todayVolume(chronology, today, timezone) },
      groups: [...groups.values()],
      nextCursor: nextListCursor(fetched.length, rows.at(-1)),
    }
  }

  #todayVolume(chronology: SQL, today: string, timezone: string): number {
    const start = dayStartUtc(today, timezone).toISOString()
    const end = dayStartUtc(dayAfter(today), timezone).toISOString()
    const counted = this.#db
      .select({ volume: sql<number>`COUNT(*)` })
      .from(feedItems)
      .innerJoin(subscriptions, eq(subscriptions.feedId, feedItems.feedId))
      .where(sql`${chronology} >= ${start} AND ${chronology} < ${end}`)
      .all()[0]
    return counted?.volume ?? 0
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
      chronology: new Date(chronologyTime(current.publishedAt, current.firstSeenAt, now)).toISOString(),
      feedItemId,
    }
    const next = this.#db
      .select({
        feedItemId: feedItems.id,
        title: feedItems.title,
        feedId: feeds.id,
        feedTitle: feeds.title,
        link: feedItems.link,
        publishedAt: feedItems.publishedAt,
        imageUrl: feedItems.imageUrl,
        summary: feedItems.summary,
        firstSeenAt: feedItems.firstSeenAt,
        savedAt: libraryItems.savedAt,
      })
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
    title: row.title ?? 'untitled',
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

function calendarLabel(date: Date, timezone: string): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  })
    .format(date)
    .toLowerCase()
}
