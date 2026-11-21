function format(dateKey: string, options: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat('en-GB', { ...options, timeZone: 'UTC' }).format(new Date(`${dateKey}T12:00:00Z`))
}

export function shortMonth(dateKey: string): string {
  return format(dateKey, { month: 'long' }).slice(0, 3)
}

export function dayAndMonth(dateKey: string): string {
  return `${Number(dateKey.slice(8, 10))} ${shortMonth(dateKey)}`
}

export function shortDate(dateKey: string, today: string): string {
  return sameYear(dateKey, today) ? dayAndMonth(dateKey) : `${dayAndMonth(dateKey)} ${dateKey.slice(0, 4)}`
}

export function longDay(dateKey: string): string {
  return format(dateKey, { weekday: 'long', day: 'numeric', month: 'long' })
}

export function weekday(dateKey: string): string {
  return format(dateKey, { weekday: 'long' })
}

export function fullDate(dateKey: string): string {
  return format(dateKey, { day: 'numeric', month: 'long', year: 'numeric' })
}

export function dayOfYear(dateKey: string, today: string): string {
  return sameYear(dateKey, today) ? format(dateKey, { day: 'numeric', month: 'long' }) : fullDate(dateKey)
}

export function monthName(dateKey: string, today: string): string {
  return sameYear(dateKey, today) ? format(dateKey, { month: 'long' }) : monthOfYear(dateKey)
}

export function monthOfYear(dateKey: string): string {
  return format(dateKey, { month: 'long', year: 'numeric' })
}

export function relativeDay(dateKey: string, today: string): 'Today' | 'Yesterday' | undefined {
  if (dateKey === today) return 'Today'
  if (dateKey === dayBefore(today)) return 'Yesterday'
  return undefined
}

export function dayTitle(dateKey: string, today: string): string {
  return relativeDay(dateKey, today) ?? namedDay(dateKey, today)
}

export function namedDay(dateKey: string, today: string): string {
  return sameYear(dateKey, today) ? longDay(dateKey) : `${longDay(dateKey)} ${dateKey.slice(0, 4)}`
}

export function headingDay(dateKey: string, today: string): string {
  return namedDay(dateKey, today).replace(/(\d+) /, '$1\u00a0')
}

export function shortHeadingDay(dateKey: string, today: string): string {
  const day = `${format(dateKey, { weekday: 'short' })} ${Number(dateKey.slice(8, 10))}\u00a0${shortMonth(dateKey)}`
  return sameYear(dateKey, today) ? day : `${day} ${dateKey.slice(0, 4)}`
}

export function dayAndTime(dateKey: string, time: string | null, today: string): string {
  const relative = relativeDay(dateKey, today)
  if (!relative) return dayOfYear(dateKey, today)
  return time === null ? relative : `${relative}, ${time}`
}

export function dayBefore(dateKey: string): string {
  return new Date(Date.parse(`${dateKey}T12:00:00Z`) - 86_400_000).toISOString().slice(0, 10)
}

export function localDay(instant: string | Date): string {
  return new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(
    new Date(instant),
  )
}

export function daysBefore(dateKey: string, today: string): number {
  return Math.round((Date.parse(today) - Date.parse(dateKey)) / 86_400_000)
}

function lapse(dateKey: string, today: string): string {
  const days = daysBefore(dateKey, today)
  if (days < 45) return counted(days, 'day')
  if (days < 365) return counted(Math.round(days / 30), 'month')
  return counted(Math.floor(days / 365), 'year')
}

export function ago(dateKey: string, today: string): string {
  if (dateKey >= today) return 'today'
  return relativeDay(dateKey, today)?.toLowerCase() ?? `${lapse(dateKey, today)} ago`
}

export function dayDistance(dateKey: string, today: string): string {
  if (dateKey > today) return 'Tomorrow'
  return relativeDay(dateKey, today) ?? `${lapse(dateKey, today)} ago`
}

export function counted(count: number, noun: string): string {
  return count === 1 ? `1 ${noun}` : `${count.toLocaleString('en-GB')} ${noun}s`
}

function sameYear(dateKey: string, today: string): boolean {
  return dateKey.slice(0, 4) === today.slice(0, 4)
}
