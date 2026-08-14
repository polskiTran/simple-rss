import { CADENCE_GRID_WEEKS } from '../../shared/api.js'

const DAY_MS = 24 * 60 * 60 * 1_000

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
