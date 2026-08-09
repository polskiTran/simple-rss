import { MIN_PASSWORD_LENGTH, newPasswordSchema } from '../../shared/api.js'
import { ApiError } from '../api.js'

/**
 * What to say when the server refuses. Shared by the three screens that ask
 * for a secret, so they cannot drift into telling the Owner three different
 * things about the same refusal.
 *
 * The wording says what happened and nothing more. A message that
 * distinguished "no Owner yet" from "wrong password" would hand someone
 * guessing exactly the hint the server's generic errors withhold.
 */
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

/**
 * The reasons not to send a new password at all, checked here rather than at
 * the server so both forms that choose one apply the same two rules.
 */
export function reasonToHold(password: string, confirmation: string): string | undefined {
  if (password !== confirmation) return 'those two passwords are not the same'
  if (password.length < MIN_PASSWORD_LENGTH) return tooShort()
  if (!newPasswordSchema.safeParse(password).success) return 'that password is too long'
  return undefined
}

/**
 * Which side a failed fetch fell on. A rejected fetch is the network staying
 * silent — `unreachable`; anything else — a refusal, a body that fails its
 * schema — is the reader's problem, `unavailable`. Shared so every view tells
 * the Owner the same thing about the same silence, and the way back it
 * implies: check the connection, or wait for the reader.
 */
export function failureKind(error: unknown): 'unreachable' | 'unavailable' {
  return error instanceof TypeError ? 'unreachable' : 'unavailable'
}

/** Rounded up, because a wait reported as shorter than it is invites a retry. */
function describeWait(seconds: number | undefined): string {
  if (!seconds) return 'a little while'
  if (seconds < 120) return 'a minute'

  return `${Math.ceil(seconds / 60)} minutes`
}
