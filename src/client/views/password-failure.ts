import { MIN_PASSWORD_LENGTH, newPasswordSchema, type ApiErrorCode } from '../../shared/api.js'
import { hasOwn } from '../../shared/record.js'
import { ApiError } from '../api.js'

const TOO_SHORT = `A password needs at least ${MIN_PASSWORD_LENGTH} characters.`

/** What the forms that send a password — setup, sign-in, password change — say about a refusal. */
const PASSWORD_FAILURE_COPY = {
  invalid_request: TOO_SHORT,
  invalid_credentials: 'That password isn’t right. Passwords are case-sensitive.',
} satisfies Partial<Record<ApiErrorCode, string>>

/**
 * What a password form says after Submit, one reason at a time: on the field
 * that has to change, or as the form's note when no field is to blame.
 * Undefined says nothing.
 */
export type Feedback<Field extends string> =
  | { readonly field: Field; readonly reason: string }
  | { readonly note: string }
  | undefined

export function reasonOn<Field extends string>(feedback: Feedback<Field>, field: Field): string | undefined {
  return feedback && 'field' in feedback && feedback.field === field ? feedback.reason : undefined
}

export function noteOf(feedback: Feedback<string>): string {
  return feedback && 'note' in feedback ? feedback.note : ''
}

/** Editing a field answers its reason; a note about the whole form stays until the next Submit. */
export function afterEdit<Field extends string>(feedback: Feedback<Field>): Feedback<Field> {
  return feedback && 'field' in feedback ? undefined : feedback
}

export function describeFailure(cause: unknown): string {
  if (!(cause instanceof ApiError)) return 'The reader is unavailable. Try again in a moment.'
  if (cause.code === 'too_many_attempts') {
    return `Too many attempts. Try again in ${describeWait(cause.retryAfterSeconds)}.`
  }

  return hasOwn(PASSWORD_FAILURE_COPY, cause.code) ? PASSWORD_FAILURE_COPY[cause.code] : 'That didn’t work. Try again.'
}

/** Why a new password can't be sent yet, on the field that has to change: the password before its confirmation. */
export function reasonToHold(
  password: string,
  confirmation: string,
): { readonly field: 'password' | 'confirmation'; readonly reason: string } | undefined {
  if (password.length < MIN_PASSWORD_LENGTH) return { field: 'password', reason: TOO_SHORT }
  if (!newPasswordSchema.safeParse(password).success) return { field: 'password', reason: 'That password is too long.' }
  if (password !== confirmation) return { field: 'confirmation', reason: 'Those two passwords aren’t the same.' }
  return undefined
}

function describeWait(seconds: number | undefined): string {
  if (!seconds) return 'a little while'
  if (seconds < 120) return 'a minute'

  return `${Math.ceil(seconds / 60)} minutes`
}
