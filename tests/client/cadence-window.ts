import type { CadenceObservation } from '../../src/shared/api.js'

const DAY_MS = 24 * 60 * 60 * 1_000

export function cadenceWindow(
  counts: Record<string, number> = {},
  days = 181,
  start = '2026-02-09',
): CadenceObservation[] {
  const opening = Date.parse(`${start}T00:00:00.000Z`)
  return Array.from({ length: days }, (_, index) => {
    const date = new Date(opening + index * DAY_MS).toISOString().slice(0, 10)
    return { date, count: counts[date] ?? 0 }
  })
}
