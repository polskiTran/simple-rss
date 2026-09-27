/**
 * A Feed's Rhythm, read from its Cadence strip (per-day counts, oldest first)
 * by the days that saw at least one Feed Item — so one busy day reads as the
 * burst it was, not as a daily habit.
 */
export const RHYTHMS = ['daily', 'weekly', 'monthly', 'inactive'] as const
export type Rhythm = (typeof RHYTHMS)[number]

export const RHYTHM_LABELS = {
  daily: 'Daily',
  weekly: 'Weekly',
  monthly: 'Monthly',
  inactive: 'Inactive',
} as const satisfies Record<Rhythm, string>

export function rhythmOf(cadence: readonly number[]): Rhythm {
  const activeDays = cadence.filter((count) => count > 0).length
  if (activeDays >= 15) return 'daily'
  if (activeDays >= 4) return 'weekly'
  if (activeDays >= 1) return 'monthly'
  return 'inactive'
}
