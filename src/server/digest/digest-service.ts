import { desc, eq } from 'drizzle-orm'
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import type { Digest, DigestGroup, DigestItem } from '../../shared/api.js'
import type { Clock } from '../clock.js'
import type { SqliteDatabase } from '../persistence/database.js'
import type { InstallationSettingsStore } from '../persistence/installation-settings.js'
import { feedItems, feeds, subscriptions } from '../persistence/schema.js'

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
    const timezone = this.#settings.read()?.timezone ?? 'UTC'
    const now = this.#clock.now()
    const futureLimit = now.getTime() + 24 * 60 * 60 * 1_000
    const rows = this.#db
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
      })
      .from(feedItems)
      .innerJoin(feeds, eq(feeds.id, feedItems.feedId))
      .innerJoin(subscriptions, eq(subscriptions.feedId, feeds.id))
      .orderBy(desc(feedItems.firstSeenAt))
      .all()
      .map((row) => {
        const publishedTime = row.publishedAt ? Date.parse(row.publishedAt) : Number.NaN
        const chronology =
          Number.isFinite(publishedTime) && publishedTime <= futureLimit ? publishedTime : Date.parse(row.firstSeenAt)
        return { row, chronology }
      })
      .sort((left, right) => right.chronology - left.chronology || right.row.feedItemId - left.row.feedItemId)

    const today = dateKey(now, timezone)
    const yesterday = new Date(Date.parse(`${today}T00:00:00.000Z`) - 24 * 60 * 60 * 1_000)
      .toISOString()
      .slice(0, 10)
    const groups = new Map<string, DigestGroup>()

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

      ;(group.items as DigestItem[]).push({
        feedItemId: row.feedItemId,
        title: row.title ?? 'untitled',
        feedId: row.feedId,
        feedTitle: row.feedTitle,
        link: row.link,
        publishedAt: row.publishedAt,
        displayTime: timeLabel(instant, timezone),
        imageUrl: row.imageUrl,
        summary: row.summary,
        firstSeenAt: row.firstSeenAt,
      })
    }

    return {
      today: { date: today, volume: groups.get(today)?.items.length ?? 0 },
      groups: [...groups.values()],
    }
  }
}

export function dateKey(date: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return `${values.year}-${values.month}-${values.day}`
}

function timeLabel(date: Date, timezone: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(date)
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
