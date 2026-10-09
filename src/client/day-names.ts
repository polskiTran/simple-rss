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

/** `Sat 8 Aug`, for a page title's companion. */
export function shortDay(dateKey: string): string {
  return `${format(dateKey, { weekday: 'short' })} ${Number(dateKey.slice(8, 10))} ${shortMonth(dateKey)}`
}

/** `5 Aug`, for a note that only needs to place a day. */
export function dayAndMonth(dateKey: string): string {
  return `${Number(dateKey.slice(8, 10))} ${shortMonth(dateKey)}`
}

/** `Saturday 8 August`, beside a group labelled Today or Yesterday. */
export function longDay(dateKey: string): string {
  return format(dateKey, { weekday: 'long', day: 'numeric', month: 'long' })
}

/** `Monday`. */
export function weekday(dateKey: string): string {
  return format(dateKey, { weekday: 'long' })
}

/** `3 June 2026`. */
export function fullDate(dateKey: string): string {
  return format(dateKey, { day: 'numeric', month: 'long', year: 'numeric' })
}

/** `3 August`, or `3 August 2025` once it is not this year. */
export function dayOfYear(dateKey: string, today: string): string {
  return sameYear(dateKey, today) ? format(dateKey, { day: 'numeric', month: 'long' }) : fullDate(dateKey)
}

/** `August`, or `August 2025` once it is not this year. */
export function monthName(dateKey: string, today: string): string {
  return sameYear(dateKey, today) ? format(dateKey, { month: 'long' }) : monthOfYear(dateKey)
}

/** `August 2026`. */
export function monthOfYear(dateKey: string): string {
  return format(dateKey, { month: 'long', year: 'numeric' })
}

/** `Today` or `Yesterday` when the day is one of them. */
export function relativeDay(dateKey: string, today: string): 'Today' | 'Yesterday' | undefined {
  if (dateKey === today) return 'Today'
  if (dateKey === dayBefore(today)) return 'Yesterday'
  return undefined
}

/** A day's heading: `Today`, `Yesterday`, `Saturday 8 August`, then with its year once it is not this one. */
export function dayTitle(dateKey: string, today: string): string {
  return relativeDay(dateKey, today) ?? namedDay(dateKey, today)
}

/** A day named in full, never relative: `Saturday 8 August`, the year only once it is not this one. */
export function namedDay(dateKey: string, today: string): string {
  return sameYear(dateKey, today) ? longDay(dateKey) : `${longDay(dateKey)} ${dateKey.slice(0, 4)}`
}

/** A listed item's day and time: `Today, 07:15`, `Yesterday, 09:31`, then `3 August` alone. */
export function dayAndTime(dateKey: string, time: string, today: string): string {
  const relative = relativeDay(dateKey, today)
  return relative ? `${relative}, ${time}` : dayOfYear(dateKey, today)
}

/** The calendar day before `dateKey`. */
export function dayBefore(dateKey: string): string {
  return new Date(Date.parse(`${dateKey}T12:00:00Z`) - 86_400_000).toISOString().slice(0, 10)
}

/** `1 item`, `1,204 items`. */
export function counted(count: number, noun: string): string {
  return count === 1 ? `1 ${noun}` : `${count.toLocaleString('en-GB')} ${noun}s`
}

function sameYear(dateKey: string, today: string): boolean {
  return dateKey.slice(0, 4) === today.slice(0, 4)
}
