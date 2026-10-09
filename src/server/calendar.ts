const DAY_MS = 24 * 60 * 60 * 1_000

const formats = new Map<string, Intl.DateTimeFormat>()

/** Building a DateTimeFormat costs far more than using one, so each shape is built once per timezone. */
function formatIn(timezone: string, locale: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = `${locale} ${timezone} ${JSON.stringify(options)}`
  let format = formats.get(key)
  if (!format) {
    format = new Intl.DateTimeFormat(locale, { ...options, timeZone: timezone })
    formats.set(key, format)
  }
  return format
}

export function dateKey(date: Date, timezone: string): string {
  const parts = formatIn(timezone, 'en-US', { year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date)
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return `${values.year}-${values.month}-${values.day}`
}

export function timeLabel(date: Date, timezone: string): string {
  return formatIn(timezone, 'en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(date)
}

function dayBefore(dayKey: string): string {
  return new Date(Date.parse(`${dayKey}T00:00:00.000Z`) - DAY_MS).toISOString().slice(0, 10)
}

export function dayAfter(dayKey: string): string {
  return new Date(Date.parse(`${dayKey}T00:00:00.000Z`) + DAY_MS).toISOString().slice(0, 10)
}

/**
 * `dateKey` for many stored instants in one timezone: Intl runs once per day
 * touched rather than once per instant, so grouping a whole Feed stays cheap.
 * Every offset is under a day, so the answer is the instant's UTC date or a
 * neighbour, settled against where those days begin.
 */
export function dayKeysIn(timezone: string): (instant: string) => string {
  const starts = new Map<string, string>()
  const startOf = (day: string) => {
    let start = starts.get(day)
    if (start === undefined) {
      start = dayStartUtc(day, timezone).toISOString()
      starts.set(day, start)
    }
    return start
  }
  return (instant) => {
    const day = instant.slice(0, 10)
    if (instant < startOf(day)) return dayBefore(day)
    const next = dayAfter(day)
    return instant < startOf(next) ? day : next
  }
}

/**
 * The UTC instant a timezone's calendar day begins: its midnight under the offset
 * from one side of the day or the other. A DST transition at midnight leaves
 * only one of the two on the day's first instant — where midnight is skipped,
 * the day begins at the transition itself.
 */
export function dayStartUtc(dayKey: string, timezone: string): Date {
  const guess = Date.parse(`${dayKey}T00:00:00.000Z`)
  const candidates = [guess - DAY_MS, guess + DAY_MS].map((side) => guess - millisecondsAheadOfUtc(side, timezone))
  const start = candidates.find(
    (instant) => dateKey(new Date(instant), timezone) === dayKey && dateKey(new Date(instant - 1), timezone) !== dayKey,
  )
  return new Date(start ?? Math.min(...candidates))
}

function millisecondsAheadOfUtc(instant: number, timezone: string): number {
  const parts = formatIn(timezone, 'en-US', {
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

/** Whole days from `earlier` to `later`, both day keys. */
export function daysBetween(later: string, earlier: string): number {
  return Math.round((Date.parse(`${later}T00:00:00.000Z`) - Date.parse(`${earlier}T00:00:00.000Z`)) / DAY_MS)
}
