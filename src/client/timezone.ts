import { ApiError } from './api.js'

export function timezoneFailure(cause: unknown): string {
  if (!(cause instanceof ApiError)) return 'Can’t reach simple. Check your connection and choose the timezone again.'
  return cause.code === 'unknown_timezone'
    ? 'That timezone isn’t recognized. Choose another.'
    : 'The timezone couldn’t be changed. Choose it again in a moment.'
}

export function timezoneOptions(current: string): string[] {
  const known = typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : []
  return known.includes(current) ? [...known] : [current, ...known]
}
