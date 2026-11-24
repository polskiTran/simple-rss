import { ApiError } from './api.js'

export function timezoneFailure(cause: unknown): string {
  if (!(cause instanceof ApiError)) return 'The reader is unavailable. Try again in a moment.'
  return cause.code === 'unknown_timezone' ? 'That timezone isn’t recognized.' : 'The timezone couldn’t be changed.'
}

export function timezoneOptions(current: string): string[] {
  const known = typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : []
  return known.includes(current) ? [...known] : [current, ...known]
}
