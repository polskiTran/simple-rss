const FUTURE_TOLERANCE_MS = 24 * 60 * 60 * 1_000

export function chronologyTime(publishedAt: string | null, firstSeenAt: string, now: Date): number {
  const published = publishedAt ? Date.parse(publishedAt) : Number.NaN
  return Number.isFinite(published) && published <= now.getTime() + FUTURE_TOLERANCE_MS
    ? published
    : Date.parse(firstSeenAt)
}

export function plausibleHorizon(now: Date): string {
  return new Date(now.getTime() + FUTURE_TOLERANCE_MS).toISOString()
}

export function inDigestOrder<Row extends { feedItemId: number; publishedAt: string | null; firstSeenAt: string }>(
  rows: readonly Row[],
  now: Date,
): Array<{ row: Row; chronology: number }> {
  return rows
    .map((row) => ({ row, chronology: chronologyTime(row.publishedAt, row.firstSeenAt, now) }))
    .sort((left, right) => right.chronology - left.chronology || right.row.feedItemId - left.row.feedItemId)
}

const dateKeyFormats = new Map<string, Intl.DateTimeFormat>()

export function dateKey(date: Date, timezone: string): string {
  let format = dateKeyFormats.get(timezone)
  if (!format) {
    format = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })
    dateKeyFormats.set(timezone, format)
  }
  const parts = format.formatToParts(date)
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
 * Meta-row date outside the Digest's day grouping: `today, 07:15`,
 * `yesterday, 09:31`, then `3 august` — the year only once it is not this one.
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

/** The Reader header's date — `saturday, 8 august` — the year only once it is not this one. */
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

export function dayAfter(dayKey: string): string {
  return new Date(Date.parse(`${dayKey}T00:00:00.000Z`) + 24 * 60 * 60 * 1_000).toISOString().slice(0, 10)
}

/**
 * The UTC instant a timezone's calendar day begins. Two refinement rounds
 * settle the offset even when a DST transition moves it across the guess.
 */
export function dayStartUtc(dayKey: string, timezone: string): Date {
  const guess = Date.parse(`${dayKey}T00:00:00.000Z`)
  let instant = guess
  for (let round = 0; round < 2; round += 1) {
    instant = guess - millisecondsAheadOfUtc(instant, timezone)
  }
  return new Date(instant)
}

function millisecondsAheadOfUtc(instant: number, timezone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(instant)
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  const wall = Date.parse(
    `${values.year}-${values.month}-${values.day}T${values.hour}:${values.minute}:${values.second}.000Z`,
  )
  return wall - instant
}
