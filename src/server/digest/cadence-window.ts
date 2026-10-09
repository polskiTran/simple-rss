import { inArray, sql, type SQL } from 'drizzle-orm'
import { CADENCE_GRID_WEEKS, CADENCE_STRIP_DAYS } from '../../shared/api.js'
import type { DrizzleDatabase } from '../persistence/database.js'
import { feedItems, subscriptions } from '../persistence/schema.js'
import { dayAfter, dateKey, dayStartUtc } from './chronology.js'

const DAY_MS = 24 * 60 * 60 * 1_000

/** Subscribed Feed Items on each of `days`, every Feed together. */
export function dailyCounts(db: DrizzleDatabase, timezone: string, days: readonly string[]): (day: string) => number {
  const subscribed = db.select({ feedId: subscriptions.feedId }).from(subscriptions)
  const counts = new Map(
    countRows(db, timezone, days, inArray(feedItems.feedId, subscribed)).map((row) => [row.day, row.count]),
  )
  return (day) => counts.get(day) ?? 0
}

/** Each of `feedIds`' counts across `days`, in their order; a Feed with none answers zeros. */
export function cadenceByFeed(
  db: DrizzleDatabase,
  timezone: string,
  days: readonly string[],
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

/** The trailing thirty days of `cadenceByFeed`, ending today in the installation timezone. */
export function stripCadenceByFeed(
  db: DrizzleDatabase,
  timezone: string,
  now: Date,
  feedIds: readonly number[],
): (feedId: number) => number[] {
  return cadenceByFeed(db, timezone, trailingDayKeys(dateKey(now, timezone), CADENCE_STRIP_DAYS), feedIds)
}

/**
 * Feed Items under `scope` per installation-timezone day, counted in SQL: each
 * day is one range over the chronology index, so no row crosses into JavaScript.
 * `CROSS JOIN` is SQLite's order hint: without statistics the planner may
 * otherwise put the days inside and walk every item of every Feed against them.
 */
function countRows(db: DrizzleDatabase, timezone: string, days: readonly string[], scope: SQL, byFeed = false) {
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

/** The `days` most recent date keys ending with `todayKey`, oldest first. */
export function trailingDayKeys(todayKey: string, days: number): string[] {
  const today = Date.parse(`${todayKey}T00:00:00.000Z`)
  return Array.from({ length: days }, (_, index) => keyOf(today - (days - 1 - index) * DAY_MS))
}

/**
 * Date keys from the Monday opening the grid window through `todayKey`, oldest
 * first — always `CADENCE_GRID_WEEKS` columns, with today ending the last.
 */
export function gridDayKeys(todayKey: string): string[] {
  const today = Date.parse(`${todayKey}T00:00:00.000Z`)
  const mondayOffset = (new Date(today).getUTCDay() + 6) % 7
  const days = (CADENCE_GRID_WEEKS - 1) * 7 + mondayOffset + 1
  return Array.from({ length: days }, (_, index) => keyOf(today - (days - 1 - index) * DAY_MS))
}

function keyOf(utcMs: number): string {
  return new Date(utcMs).toISOString().slice(0, 10)
}
