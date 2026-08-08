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
