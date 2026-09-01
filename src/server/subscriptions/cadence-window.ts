import { CADENCE_GRID_WEEKS } from '../../shared/api.js'
import { chronologyTime, dateKey } from '../digest/chronology.js'
import type { DrizzleDatabase } from '../persistence/database.js'
import { feedItems } from '../persistence/schema.js'

const DAY_MS = 24 * 60 * 60 * 1_000

const STRIP_DAYS = 30

export function emptyCadence(): number[] {
  return Array.from({ length: STRIP_DAYS }, () => 0)
}

/**
 * Per-feed counts for the trailing thirty days in the installation timezone —
 * the cadence strip's data, shared by the Feeds list and Search's jump-to
 * group. Days follow the chronology instant, not the raw published time.
 */
export function stripCadenceByFeed(db: DrizzleDatabase, timezone: string, now: Date): Map<number, number[]> {
  const today = dateKey(now, timezone)
  const indexByDate = new Map(trailingDayKeys(today, STRIP_DAYS).map((key, index) => [key, index]))

  const cadence = new Map<number, number[]>()
  const rows = db
    .select({ feedId: feedItems.feedId, publishedAt: feedItems.publishedAt, firstSeenAt: feedItems.firstSeenAt })
    .from(feedItems)
    .all()
  for (const row of rows) {
    const time = chronologyTime(row.publishedAt, row.firstSeenAt, now)
    const index = indexByDate.get(dateKey(new Date(time), timezone))
    if (index === undefined) continue
    let counts = cadence.get(row.feedId)
    if (!counts) {
      counts = emptyCadence()
      cadence.set(row.feedId, counts)
    }
    counts[index] = (counts[index] ?? 0) + 1
  }
  return cadence
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
