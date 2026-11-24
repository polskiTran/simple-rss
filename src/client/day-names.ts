import { type DateKey, utcDayKey } from '../shared/api.js'

function format(dateKey: string, options: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat('en-GB', { ...options, timeZone: 'UTC' }).format(new Date(`${dateKey}T12:00:00Z`))
}

export function shortMonth(dateKey: DateKey): string {
  return format(dateKey, { month: 'long' }).slice(0, 3)
}

export function dayAndMonth(dateKey: DateKey): string {
  return `${Number(dateKey.slice(8, 10))} ${shortMonth(dateKey)}`
}

export function shortDate(dateKey: DateKey, today: DateKey): string {
  return sameYear(dateKey, today) ? dayAndMonth(dateKey) : `${dayAndMonth(dateKey)} ${dateKey.slice(0, 4)}`
}

export function longDay(dateKey: DateKey): string {
  return format(dateKey, { weekday: 'long', day: 'numeric', month: 'long' })
}

export function weekday(dateKey: DateKey): string {
  return format(dateKey, { weekday: 'long' })
}

export function fullDate(dateKey: DateKey): string {
  return format(dateKey, { day: 'numeric', month: 'long', year: 'numeric' })
}

export function dayOfYear(dateKey: DateKey, today: DateKey): string {
  return sameYear(dateKey, today) ? format(dateKey, { day: 'numeric', month: 'long' }) : fullDate(dateKey)
}

export function monthName(month: string, today: DateKey): string {
  return month.slice(0, 4) === today.slice(0, 4) ? format(`${month}-01`, { month: 'long' }) : monthOfYear(month)
}

export function monthOfYear(month: string): string {
  return format(`${month}-01`, { month: 'long', year: 'numeric' })
}

export function relativeDay(dateKey: DateKey, today: DateKey): 'Today' | 'Yesterday' | undefined {
  if (dateKey === today) return 'Today'
  if (dateKey === dayBefore(today)) return 'Yesterday'
  return undefined
}

export function dayTitle(dateKey: DateKey, today: DateKey): string {
  return relativeDay(dateKey, today) ?? namedDay(dateKey, today)
}

export function namedDay(dateKey: DateKey, today: DateKey): string {
  return sameYear(dateKey, today) ? longDay(dateKey) : `${longDay(dateKey)} ${dateKey.slice(0, 4)}`
}

export function headingDay(dateKey: DateKey, today: DateKey): string {
  return namedDay(dateKey, today).replace(/(\d+) /, '$1\u00a0')
}

export function shortHeadingDay(dateKey: DateKey, today: DateKey): string {
  const day = `${format(dateKey, { weekday: 'short' })} ${Number(dateKey.slice(8, 10))}\u00a0${shortMonth(dateKey)}`
  return sameYear(dateKey, today) ? day : `${day} ${dateKey.slice(0, 4)}`
}

export function dayAndTime(dateKey: DateKey, time: string | null, today: DateKey): string {
  const relative = relativeDay(dateKey, today)
  if (!relative) return dayOfYear(dateKey, today)
  return time === null ? relative : `${relative}, ${time}`
}

export function dayBefore(dateKey: DateKey): DateKey {
  return utcDayKey(Date.parse(`${dateKey}T12:00:00Z`) - 86_400_000)
}

export function daysBefore(dateKey: DateKey, today: DateKey): number {
  return Math.round((Date.parse(today) - Date.parse(dateKey)) / 86_400_000)
}

function lapse(dateKey: DateKey, today: DateKey): string {
  const days = daysBefore(dateKey, today)
  if (days < 45) return counted(days, 'day')
  if (days < 365) return counted(Math.round(days / 30), 'month')
  return counted(Math.floor(days / 365), 'year')
}

export function ago(dateKey: DateKey, today: DateKey): string {
  if (dateKey >= today) return 'today'
  return relativeDay(dateKey, today)?.toLowerCase() ?? `${lapse(dateKey, today)} ago`
}

export function dayDistance(dateKey: DateKey, today: DateKey): string {
  if (dateKey > today) return 'Tomorrow'
  return relativeDay(dateKey, today) ?? `${lapse(dateKey, today)} ago`
}

export function counted(count: number, noun: string): string {
  return count === 1 ? `1 ${noun}` : `${count.toLocaleString('en-GB')} ${noun}s`
}

function sameYear(dateKey: DateKey, today: DateKey): boolean {
  return dateKey.slice(0, 4) === today.slice(0, 4)
}

export function instantAgo(iso: string): string {
  const seconds = (Date.parse(iso) - Date.now()) / 1000
  const format = new Intl.RelativeTimeFormat('en-GB', { numeric: 'auto' })
  const [unit, size] = AGO_UNITS.find(([, span]) => Math.abs(seconds) >= span) ?? ['second', 1]
  const phrase = format.format(Math.round(seconds / size), unit)
  return phrase.charAt(0).toUpperCase() + phrase.slice(1)
}

const AGO_UNITS = [
  ['day', 86_400],
  ['hour', 3_600],
  ['minute', 60],
  ['second', 1],
] as const satisfies readonly (readonly [Intl.RelativeTimeFormatUnit, number])[]
