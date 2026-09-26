import { MIN_PASSWORD_LENGTH, newPasswordSchema } from '../../shared/api.js'
import { ApiError } from '../api.js'

export function describeFailure(cause: unknown, overrides: Record<number, string> = {}): string {
  if (!(cause instanceof ApiError)) return 'The reader is unavailable. Try again in a moment.'

  const override = overrides[cause.status]
  if (override) return override

  switch (cause.status) {
    case 400:
      return tooShort()
    case 401:
      return 'That password isn’t right. Passwords are case-sensitive.'
    case 429:
      return `Too many attempts. Try again in ${describeWait(cause.retryAfterSeconds)}.`
    default:
      return 'That didn’t work. Try again.'
  }
}

export function tooShort(): string {
  return `A password needs at least ${MIN_PASSWORD_LENGTH} characters.`
}

export function reasonToHold(password: string, confirmation: string): string | undefined {
  if (password !== confirmation) return 'Those two passwords aren’t the same.'
  if (password.length < MIN_PASSWORD_LENGTH) return tooShort()
  if (!newPasswordSchema.safeParse(password).success) return 'That password is too long.'
  return undefined
}

export function failureKind(cause: unknown): 'unreachable' | 'unavailable' {
  return cause instanceof TypeError ? 'unreachable' : 'unavailable'
}

function describeWait(seconds: number | undefined): string {
  if (!seconds) return 'a little while'
  if (seconds < 120) return 'a minute'

  return `${Math.ceil(seconds / 60)} minutes`
}
