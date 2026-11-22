import { type CadenceObservation, utcDayKey } from '../../src/shared/api.js'

const DAY_MS = 24 * 60 * 60 * 1_000

export function cadenceWindow(
  counts: Record<string, number> = {},
  days = 181,
  start = '2026-02-09',
): CadenceObservation[] {
  const opening = Date.parse(`${start}T00:00:00.000Z`)
  return Array.from({ length: days }, (_, index) => {
    const date = utcDayKey(opening + index * DAY_MS)
    return { date, count: counts[date] ?? 0 }
  })
}
