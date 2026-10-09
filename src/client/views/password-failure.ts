import { MIN_PASSWORD_LENGTH, newPasswordSchema, type ApiErrorCode } from '../../shared/api.js'
import { hasOwn } from '../../shared/record.js'
import { ApiError } from '../api.js'

const TOO_SHORT = `A password needs at least ${MIN_PASSWORD_LENGTH} characters.`

/** What the forms that send a password — setup, sign-in, password change — say about a refusal. */
const PASSWORD_FAILURE_COPY = {
  invalid_request: TOO_SHORT,
  invalid_credentials: 'That password isn’t right. Passwords are case-sensitive.',
} satisfies Partial<Record<ApiErrorCode, string>>

/** `copy` says a form's own words for any code, ahead of the shared ones. */
export function describeFailure(cause: unknown, copy: Partial<Record<ApiErrorCode, string>> = {}): string {
  if (!(cause instanceof ApiError)) return 'The reader is unavailable. Try again in a moment.'
  if (cause.code === 'too_many_attempts') {
    return `Too many attempts. Try again in ${describeWait(cause.retryAfterSeconds)}.`
  }

  const own = hasOwn(copy, cause.code) ? copy[cause.code] : undefined
  if (own) return own
  return hasOwn(PASSWORD_FAILURE_COPY, cause.code) ? PASSWORD_FAILURE_COPY[cause.code] : 'That didn’t work. Try again.'
}

export function reasonToHold(password: string, confirmation: string): string | undefined {
  if (password !== confirmation) return 'Those two passwords aren’t the same.'
  if (password.length < MIN_PASSWORD_LENGTH) return TOO_SHORT
  if (!newPasswordSchema.safeParse(password).success) return 'That password is too long.'
  return undefined
}

function describeWait(seconds: number | undefined): string {
  if (!seconds) return 'a little while'
  if (seconds < 120) return 'a minute'

  return `${Math.ceil(seconds / 60)} minutes`
}
