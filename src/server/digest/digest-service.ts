import { desc, eq } from 'drizzle-orm'
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import type { Digest, DigestItem } from '../../shared/api.js'
import type { Clock } from '../clock.js'
import type { SqliteDatabase } from '../persistence/database.js'
import type { InstallationSettingsStore } from '../persistence/installation-settings.js'
import { feedItems, feeds, libraryItems, subscriptions } from '../persistence/schema.js'
import { dateKey, dayBefore, inDigestOrder, timeLabel } from './chronology.js'

/** Chronology and installation-timezone date grouping for the Owner's Digest. */
export class DigestService {
  readonly #db: BetterSQLite3Database
  readonly #clock: Clock
  readonly #settings: InstallationSettingsStore

  constructor(options: { database: SqliteDatabase; clock: Clock; settings: InstallationSettingsStore }) {
    this.#db = drizzle(options.database)
    this.#clock = options.clock
    this.#settings = options.settings
  }

  read(): Digest {
    const timezone = this.#settings.effectiveTimezone()
    const now = this.#clock.now()
    const rows = inDigestOrder(
      this.#db
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
        .orderBy(desc(feedItems.firstSeenAt))
        .all(),
      now,
    )

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

      group.items.push({
        feedItemId: row.feedItemId,
        title: row.title ?? 'untitled',
        feedId: row.feedId,
        feedTitle: row.feedTitle,
        link: row.link,
        publishedAt: row.publishedAt,
        displayTime: timeLabel(instant, timezone),
        // The publisher's URL stays server-side; the client only ever hears
        // about the same-origin proxy route for this item.
        imageUrl: row.imageUrl === null ? null : `/api/items/${row.feedItemId}/image`,
        summary: row.summary,
        firstSeenAt: row.firstSeenAt,
        saved: row.savedAt !== null,
      })
    }

    return {
      today: { date: today, volume: groups.get(today)?.items.length ?? 0 },
      groups: [...groups.values()],
    }
  }

  /**
   * The Feed Item that follows one item in this chronology — what the Reader
   * says under `next in the digest`. Answered here so the Reader and the
   * Digest can never disagree about the order. `undefined` when the item is
   * last, or is not in the Digest at all.
   */
  after(feedItemId: number): DigestItem | undefined {
    const ordered = this.read().groups.flatMap((group) => group.items)
    const index = ordered.findIndex((entry) => entry.feedItemId === feedItemId)
    return index === -1 ? undefined : ordered[index + 1]
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
