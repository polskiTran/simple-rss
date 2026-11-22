import { type DateKey, utcDayKey } from '../shared/api.js'

const DAY_MS = 24 * 60 * 60 * 1_000

const formats = new Map<string, Intl.DateTimeFormat>()

function formatIn(timezone: string, locale: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = `${locale} ${timezone} ${JSON.stringify(options)}`
  let format = formats.get(key)
  if (!format) {
    format = new Intl.DateTimeFormat(locale, { ...options, timeZone: timezone })
    formats.set(key, format)
  }
  return format
}

export function dateKey(date: Date, timezone: string): DateKey {
  const parts = formatIn(timezone, 'en-US', { year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date)
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  // SAFETY: Intl's numeric year and 2-digit month and day of a real instant spell a calendar day that exists.
  return `${values.year}-${values.month}-${values.day}` as DateKey
}

export function timeLabel(date: Date, timezone: string): string {
  return formatIn(timezone, 'en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(date)
}

function dayBefore(dayKey: DateKey): DateKey {
  return utcDayKey(Date.parse(`${dayKey}T00:00:00.000Z`) - DAY_MS)
}

export function dayAfter(dayKey: DateKey): DateKey {
  return utcDayKey(Date.parse(`${dayKey}T00:00:00.000Z`) + DAY_MS)
}

export function dayKeysIn(timezone: string): (instant: string) => DateKey {
  const starts = new Map<DateKey, string>()
  const startOf = (day: DateKey) => {
    let start = starts.get(day)
    if (start === undefined) {
      start = dayStartUtc(day, timezone).toISOString()
      starts.set(day, start)
    }
    return start
  }
  return (instant) => {
    const day = utcDayKey(Date.parse(instant))
    if (instant < startOf(day)) return dayBefore(day)
    const next = dayAfter(day)
    return instant < startOf(next) ? day : next
  }
}

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

export function daysBetween(later: string, earlier: string): number {
  return Math.round((Date.parse(`${later}T00:00:00.000Z`) - Date.parse(`${earlier}T00:00:00.000Z`)) / DAY_MS)
}
