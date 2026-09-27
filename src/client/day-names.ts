/**
 * Names for a calendar day the server already placed in the installation
 * timezone (`2026-08-08`). The day is a date, not an instant, so it is read
 * and written in UTC and no timezone can move it.
 */
function format(dateKey: string, options: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat('en-GB', { ...options, timeZone: 'UTC' }).format(new Date(`${dateKey}T12:00:00Z`))
}

/**
 * `Sat 8 Aug`, for a page title's companion. Months are cut to three letters
 * by hand: en-GB's own short September is `Sept`.
 */
export function shortDay(dateKey: string): string {
  const weekday = format(dateKey, { weekday: 'short' })
  const month = format(dateKey, { month: 'long' }).slice(0, 3)
  return `${weekday} ${Number(dateKey.slice(8, 10))} ${month}`
}

/** `Saturday 8 August`, beside a group labelled Today or Yesterday. */
export function longDay(dateKey: string): string {
  return format(dateKey, { weekday: 'long', day: 'numeric', month: 'long' })
}

/** `August`, or `August 2025` once it is not this year. */
export function monthName(dateKey: string, today: string): string {
  const sameYear = dateKey.slice(0, 4) === today.slice(0, 4)
  return format(dateKey, sameYear ? { month: 'long' } : { month: 'long', year: 'numeric' })
}

/** The calendar day before `dateKey`. */
export function dayBefore(dateKey: string): string {
  return new Date(Date.parse(`${dateKey}T12:00:00Z`) - 86_400_000).toISOString().slice(0, 10)
}
