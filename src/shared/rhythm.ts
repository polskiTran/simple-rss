export const RHYTHMS = ['firehose', 'daily', 'weekly', 'monthly', 'inactive'] as const
export type Rhythm = (typeof RHYTHMS)[number]

export const RHYTHM_LABELS = {
  firehose: 'Firehose',
  daily: 'Daily',
  weekly: 'Weekly',
  monthly: 'Monthly',
  inactive: 'Inactive',
} as const satisfies Record<Rhythm, string>

export const FIREHOSE_ITEMS = 90

export function rhythmOf(cadence: readonly number[]): Rhythm {
  const items = cadence.reduce((sum, count) => sum + count, 0)
  if (items >= FIREHOSE_ITEMS) return 'firehose'
  const activeDays = cadence.filter((count) => count > 0).length
  if (activeDays >= 15) return 'daily'
  if (activeDays >= 4) return 'weekly'
  if (activeDays >= 1) return 'monthly'
  return 'inactive'
}
