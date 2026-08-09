/**
 * Digest chronology, shared with anything that orders or buckets Feed Items.
 * An item orders by a valid publication time and falls back to first-seen;
 * a date more than a day ahead of now is treated as implausible and also
 * falls back, so a publisher's broken clock cannot pin an item to the top.
 */

const FUTURE_TOLERANCE_MS = 24 * 60 * 60 * 1_000

export function chronologyTime(publishedAt: string | null, firstSeenAt: string, now: Date): number {
  const published = publishedAt ? Date.parse(publishedAt) : Number.NaN
  return Number.isFinite(published) && published <= now.getTime() + FUTURE_TOLERANCE_MS
    ? published
    : Date.parse(firstSeenAt)
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

export function timeLabel(date: Date, timezone: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(date)
}

/**
 * The meta-row date outside the Digest's day grouping — an opened Feed's
 * items, the Library — where the day carries the meaning the grouping would
 * otherwise give: `today, 07:15`, `yesterday, 09:31`, then `3 august`, with
 * the year only once it stops being this one.
 */
export function metaRowDate(instant: Date, itemDate: string, today: string, timezone: string): string {
  if (itemDate === today) return `today, ${timeLabel(instant, timezone)}`
  if (itemDate === dayBefore(today)) return `yesterday, ${timeLabel(instant, timezone)}`

  const sameYear = itemDate.slice(0, 4) === today.slice(0, 4)
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    day: 'numeric',
    month: 'long',
    ...(sameYear ? {} : { year: 'numeric' }),
  })
    .format(instant)
    .toLowerCase()
}

export function dayBefore(dayKey: string): string {
  return new Date(Date.parse(`${dayKey}T00:00:00.000Z`) - 24 * 60 * 60 * 1_000).toISOString().slice(0, 10)
}
