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

/**
 * The newest publication instant chronology will believe, as the ISO string
 * a SQL comparison against stored `published_at` needs — for queries that
 * must apply this file's fallback rule before a LIMIT, where sorting in
 * JavaScript would come too late.
 */
export function plausibleHorizon(now: Date): string {
  return new Date(now.getTime() + FUTURE_TOLERANCE_MS).toISOString()
}

/**
 * Rows in Digest order — newest chronology first, ties to the newer row —
 * carrying each row's resolved chronology alongside it for date rendering.
 * The one ordering the Digest, the Library, and search all speak.
 */
export function inDigestOrder<Row extends { feedItemId: number; publishedAt: string | null; firstSeenAt: string }>(
  rows: readonly Row[],
  now: Date,
): Array<{ row: Row; chronology: number }> {
  return rows
    .map((row) => ({ row, chronology: chronologyTime(row.publishedAt, row.firstSeenAt, now) }))
    .sort((left, right) => right.chronology - left.chronology || right.row.feedItemId - left.row.feedItemId)
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

/**
 * The Reader header's date — `saturday, 8 august` — which names the weekday
 * because a single opened article has room for it, with the year only once
 * it stops being this one.
 */
export function readerDate(instant: Date, today: string, timezone: string): string {
  const sameYear = dateKey(instant, timezone).slice(0, 4) === today.slice(0, 4)
  const weekday = new Intl.DateTimeFormat('en-GB', { timeZone: timezone, weekday: 'long' }).format(instant)
  const day = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    day: 'numeric',
    month: 'long',
    ...(sameYear ? {} : { year: 'numeric' }),
  }).format(instant)
  return `${weekday}, ${day}`.toLowerCase()
}

export function dayBefore(dayKey: string): string {
  return new Date(Date.parse(`${dayKey}T00:00:00.000Z`) - 24 * 60 * 60 * 1_000).toISOString().slice(0, 10)
}
