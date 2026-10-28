/**
 * Every word the client says about a calendar day, month, or count. The server
 * places days in the installation timezone and sends their keys (`2026-08-08`);
 * a key is a date, not an instant, so it is read and written in UTC and no
 * timezone — the browser's included — can move it.
 */
function format(dateKey: string, options: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat('en-GB', { ...options, timeZone: 'UTC' }).format(new Date(`${dateKey}T12:00:00Z`))
}

/** `Aug`. Cut to three letters by hand: en-GB's own short September is `Sept`. */
export function shortMonth(dateKey: string): string {
  return format(dateKey, { month: 'long' }).slice(0, 3)
}

export function shortDay(dateKey: string): string {
  return `${format(dateKey, { weekday: 'short' })} ${Number(dateKey.slice(8, 10))} ${shortMonth(dateKey)}`
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

/** A recent day with its time, when the item has one; an older day alone. */
export function dayAndTime(dateKey: string, time: string | null, today: string): string {
  const relative = relativeDay(dateKey, today)
  if (!relative) return dayOfYear(dateKey, today)
  return time === null ? relative : `${relative}, ${time}`
}

export function dayBefore(dateKey: string): string {
  return new Date(Date.parse(`${dateKey}T12:00:00Z`) - 86_400_000).toISOString().slice(0, 10)
}

/**
 * The key of the browser's own calendar day an instant falls on. Only for
 * instants the server sends without a day — a Feed it has not recorded yet —
 * since every recorded day already arrives as a key.
 */
export function localDay(instant: string | Date): string {
  // en-CA writes a date as its key: `2026-08-08`.
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

export function counted(count: number, noun: string): string {
  return count === 1 ? `1 ${noun}` : `${count.toLocaleString('en-GB')} ${noun}s`
}

function sameYear(dateKey: string, today: string): boolean {
  return dateKey.slice(0, 4) === today.slice(0, 4)
}
