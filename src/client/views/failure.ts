import { MIN_PASSWORD_LENGTH, newPasswordSchema } from '../../shared/api.js'
import { ApiError } from '../api.js'

export function describeFailure(error: unknown, overrides: Record<number, string> = {}): string {
  if (!(error instanceof ApiError)) return 'the reader is unavailable'

  const override = overrides[error.status]
  if (override) return override

  switch (error.status) {
    case 400:
      return tooShort()
    case 401:
      return 'that password is not right'
    case 429:
      return `too many attempts — try again in ${describeWait(error.retryAfterSeconds)}`
    default:
      return 'that did not work'
  }
}

export function tooShort(): string {
  return `a password needs at least ${MIN_PASSWORD_LENGTH} characters`
}

export function reasonToHold(password: string, confirmation: string): string | undefined {
  if (password !== confirmation) return 'those two passwords are not the same'
  if (password.length < MIN_PASSWORD_LENGTH) return tooShort()
  if (!newPasswordSchema.safeParse(password).success) return 'that password is too long'
  return undefined
}

export function failureKind(error: unknown): 'unreachable' | 'unavailable' {
  return error instanceof TypeError ? 'unreachable' : 'unavailable'
}

function describeWait(seconds: number | undefined): string {
  if (!seconds) return 'a little while'
  if (seconds < 120) return 'a minute'

  return `${Math.ceil(seconds / 60)} minutes`
}
