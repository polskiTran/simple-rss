import { inArray, sql, type SQL } from 'drizzle-orm'
import { CADENCE_GRID_WEEKS, CADENCE_STRIP_DAYS, type DateKey, utcDayKey } from '../../shared/api.js'
import type { DrizzleDatabase } from '../persistence/database.js'
import { feedItems, subscriptions } from '../persistence/schema.js'
import { dayAfter, dateKey, dayStartUtc } from '../calendar.js'

const DAY_MS = 24 * 60 * 60 * 1_000

export function dailyCounts(db: DrizzleDatabase, timezone: string, days: readonly DateKey[]): (day: string) => number {
  const subscribed = db.select({ feedId: subscriptions.feedId }).from(subscriptions)
  const counts = new Map(
    countRows(db, timezone, days, inArray(feedItems.feedId, subscribed)).map((row) => [row.day, row.count]),
  )
  return (day) => counts.get(day) ?? 0
}

export function cadenceByFeed(
  db: DrizzleDatabase,
  timezone: string,
  days: readonly DateKey[],
  feedIds: readonly number[],
): (feedId: number) => number[] {
  const counts = new Map<number, Map<string, number>>()
  const rows = feedIds.length > 0 ? countRows(db, timezone, days, inArray(feedItems.feedId, [...feedIds]), true) : []
  for (const { feedId, day, count } of rows) {
    const byDay = counts.get(feedId) ?? new Map<string, number>()
    byDay.set(day, count)
    counts.set(feedId, byDay)
  }
  return (feedId) => days.map((day) => counts.get(feedId)?.get(day) ?? 0)
}

export function stripCadenceByFeed(
  db: DrizzleDatabase,
  timezone: string,
  now: Date,
  feedIds: readonly number[],
): (feedId: number) => number[] {
  return cadenceByFeed(db, timezone, trailingDayKeys(dateKey(now, timezone), CADENCE_STRIP_DAYS), feedIds)
}

function countRows(db: DrizzleDatabase, timezone: string, days: readonly DateKey[], scope: SQL, byFeed = false) {
  const last = days.at(-1)
  if (last === undefined) return []
  const starts = [...days, dayAfter(last)].map((day) => dayStartUtc(day, timezone).toISOString())
  const spans = days.map((day, index) => sql`(${day}, ${starts[index]}, ${starts[index + 1]})`)
  const feed = byFeed ? feedItems.feedId : sql`NULL`
  return db.all<{ feedId: number; day: string; count: number }>(sql`
    WITH days (day, opening, closing) AS (VALUES ${sql.join(spans, sql`, `)})
    SELECT ${feed} AS feedId, days.day AS day, count(*) AS count
    FROM days CROSS JOIN ${feedItems}
    WHERE ${feedItems.chronologyAt} >= days.opening AND ${feedItems.chronologyAt} < days.closing AND ${scope}
    GROUP BY feedId, days.day`)
}

export function trailingDayKeys(todayKey: DateKey, days: number): DateKey[] {
  const today = Date.parse(`${todayKey}T00:00:00.000Z`)
  return Array.from({ length: days }, (_, index) => utcDayKey(today - (days - 1 - index) * DAY_MS))
}

export function gridDayKeys(todayKey: DateKey): DateKey[] {
  const today = Date.parse(`${todayKey}T00:00:00.000Z`)
  const mondayOffset = (new Date(today).getUTCDay() + 6) % 7
  const days = (CADENCE_GRID_WEEKS - 1) * 7 + mondayOffset + 1
  return Array.from({ length: days }, (_, index) => utcDayKey(today - (days - 1 - index) * DAY_MS))
}
