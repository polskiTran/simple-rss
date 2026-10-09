import { createHash, timingSafeEqual } from 'node:crypto'
import type { AuthStatus } from '../../shared/api.js'
import type { Clock } from '../clock.js'
import type { Logger } from '../logger.js'
import type { DrizzleDatabase } from '../persistence/database.js'
import { CredentialStore, type IssuedSession } from './credentials.js'
import { argon2idHasher, type PasswordHasher } from './password.js'
import { LoginRateLimiter, type AllowedAttempt } from './rate-limit.js'

export const MIN_SETUP_SECRET_LENGTH = 16

/** How Authentication waits out a delay; the harness records instead of waiting. */
export type Sleeper = (milliseconds: number) => Promise<void>

const realSleeper: Sleeper = (milliseconds) =>
  milliseconds <= 0 ? Promise.resolve() : new Promise((resolve) => setTimeout(resolve, milliseconds))

export interface AuthenticationOptions {
  readonly credentials: CredentialStore
  readonly hasher: PasswordHasher
  readonly limiter: LoginRateLimiter
  readonly sleep: Sleeper
  readonly clock: Clock
  readonly logger: Logger
  /** From the deployment environment; absent on an unconfigured installation. */
  readonly setupSecret: string | undefined
}

type Throttled = { readonly kind: 'rate-limited'; readonly retryAfterSeconds: number }

export type ClaimOutcome =
  | { readonly kind: 'claimed'; readonly session: IssuedSession }
  | { readonly kind: 'rejected' }
  | { readonly kind: 'already-claimed' }
  | { readonly kind: 'unavailable'; readonly reason: string }
  | Throttled

export type SignInOutcome =
  | { readonly kind: 'signed-in'; readonly session: IssuedSession }
  | { readonly kind: 'rejected' }
  | Throttled

export type PasswordChangeOutcome =
  | { readonly kind: 'changed'; readonly revoked: number }
  | { readonly kind: 'rejected' }
  | Throttled

interface Attempt {
  readonly client: string
}

export class Authentication {
  readonly #deps: AuthenticationOptions

  constructor(options: AuthenticationOptions) {
    this.#deps = options
  }

  status(token: string | undefined): AuthStatus {
    return { claimed: this.#isClaimed(), authenticated: this.authenticate(token) }
  }

  /** Why claiming is blocked, or `undefined`. */
  setupBlocker(): string | undefined {
    if (this.#isClaimed()) return undefined

    const secret = this.#deps.setupSecret
    if (!secret) return 'setup secret is not configured'
    if (secret.length < MIN_SETUP_SECRET_LENGTH) return 'setup secret is too short'
    return undefined
  }

  async claim(input: Attempt & { readonly setupSecret: string; readonly password: string }): Promise<ClaimOutcome> {
    const blocker = this.setupBlocker()
    if (blocker) {
      this.#deps.logger.warn('auth.setup_unavailable', { reason: blocker })
      return { kind: 'unavailable', reason: blocker }
    }

    if (this.#isClaimed()) return { kind: 'already-claimed' }

    const attempt = await this.#beginAttempt(input.client, 'auth.claim_throttled')
    if (attempt.kind === 'rate-limited') return attempt

    try {
      if (!matches(this.#deps.setupSecret, input.setupSecret)) {
        await this.#reject(attempt, input.client, 'auth.claim_rejected')
        return { kind: 'rejected' }
      }

      const passwordHash = await this.#deps.hasher.hash(input.password)
      await this.#delaySuccess(attempt)
      const session = this.#deps.credentials.claim(passwordHash, this.#deps.clock.now())
      attempt.recordSuccess()

      if (!session) {
        this.#deps.logger.warn('auth.claim_lost_race')
        return { kind: 'already-claimed' }
      }

      this.#deps.logger.info('auth.claimed')
      return { kind: 'claimed', session }
    } catch (error) {
      attempt.cancel()
      throw error
    }
  }

  async signIn(input: Attempt & { readonly password: string }): Promise<SignInOutcome> {
    const attempt = await this.#beginAttempt(input.client, 'auth.sign_in_throttled')
    if (attempt.kind === 'rate-limited') return attempt

    try {
      const passwordHash = await this.#verifiedPasswordHash(input.password)
      if (!passwordHash) {
        await this.#reject(attempt, input.client, 'auth.sign_in_rejected')
        return { kind: 'rejected' }
      }

      await this.#delaySuccess(attempt)
      const now = this.#deps.clock.now()
      this.#deps.credentials.prune(now)
      const session = this.#deps.credentials.issueSession(passwordHash, now)

      if (!session) {
        attempt.cancel()
        this.#deps.logger.warn('auth.sign_in_stale', { client: input.client })
        return { kind: 'rejected' }
      }

      attempt.recordSuccess()
      this.#deps.logger.info('auth.signed_in', { client: input.client })
      return { kind: 'signed-in', session }
    } catch (error) {
      attempt.cancel()
      throw error
    }
  }

  /** Whether this token is a live session, sliding its idle deadline. */
  authenticate(token: string | undefined): boolean {
    return token ? this.#deps.credentials.touch(token, this.#deps.clock.now()) : false
  }

  /** Ends this device's session and leaves every other device alone. */
  signOut(token: string | undefined): void {
    if (!token) return
    this.#deps.credentials.revoke(token)
    this.#deps.logger.info('auth.signed_out')
  }

  /** Signs every device out — including the one asking. */
  async changePassword(
    input: Attempt & { readonly currentPassword: string; readonly newPassword: string },
  ): Promise<PasswordChangeOutcome> {
    const attempt = await this.#beginAttempt(input.client, 'auth.password_change_throttled')
    if (attempt.kind === 'rate-limited') return attempt

    try {
      const currentHash = await this.#verifiedPasswordHash(input.currentPassword)
      if (!currentHash) {
        await this.#reject(attempt, input.client, 'auth.password_change_rejected')
        return { kind: 'rejected' }
      }

      const passwordHash = await this.#deps.hasher.hash(input.newPassword)
      await this.#delaySuccess(attempt)
      const outcome = this.#deps.credentials.changePassword(currentHash, passwordHash, this.#deps.clock.now())

      if (outcome.kind === 'stale-verifier') {
        attempt.cancel()
        this.#deps.logger.warn('auth.password_change_stale', { client: input.client })
        return { kind: 'rejected' }
      }

      attempt.recordSuccess()
      this.#deps.logger.info('auth.password_changed', { sessionsRevoked: outcome.revoked })
      return { kind: 'changed', revoked: outcome.revoked }
    } catch (error) {
      attempt.cancel()
      throw error
    }
  }

  async resetPassword(newPassword: string): Promise<number> {
    const passwordHash = await this.#deps.hasher.hash(newPassword)
    const revoked = this.#deps.credentials.resetPassword(passwordHash, this.#deps.clock.now())
    this.#deps.logger.warn('auth.password_reset', { sessionsRevoked: revoked })
    return revoked
  }

  async #verifiedPasswordHash(password: string): Promise<string | undefined> {
    const passwordHash = this.#deps.credentials.passwordHash()
    if (!passwordHash) return undefined
    return (await this.#deps.hasher.verify(passwordHash, password)) ? passwordHash : undefined
  }

  #isClaimed(): boolean {
    return this.#deps.credentials.passwordHash() !== undefined
  }

  async #beginAttempt(client: string, event: string): Promise<AllowedAttempt | Throttled> {
    const verdict = this.#deps.limiter.begin(client)
    if (verdict.kind === 'allowed') return verdict

    this.#deps.logger.warn(event, { client, retryAfterSeconds: verdict.retryAfterSeconds })
    await this.#deps.sleep(verdict.delayMs)
    return { kind: 'rate-limited', retryAfterSeconds: verdict.retryAfterSeconds }
  }

  async #reject(attempt: AllowedAttempt, client: string, event: string): Promise<void> {
    const delayMs = attempt.recordFailure()
    this.#deps.logger.warn(event, { client })
    if (delayMs > 0) await this.#deps.sleep(delayMs)
  }

  async #delaySuccess(attempt: AllowedAttempt): Promise<void> {
    if (attempt.successDelayMs > 0) await this.#deps.sleep(attempt.successDelayMs)
  }
}

export interface AuthenticationDependencies {
  readonly db: DrizzleDatabase
  readonly clock: Clock
  readonly logger: Logger
  readonly setupSecret: string | undefined
  readonly sleep?: Sleeper
}

export function createAuthentication(deps: AuthenticationDependencies): Authentication {
  const credentials = new CredentialStore(deps.db)

  credentials.prune(deps.clock.now())

  return new Authentication({
    credentials,
    hasher: argon2idHasher(),
    limiter: new LoginRateLimiter(deps.clock),
    sleep: deps.sleep ?? realSleeper,
    clock: deps.clock,
    logger: deps.logger,
    setupSecret: deps.setupSecret,
  })
}

function matches(expected: string | undefined, presented: string): boolean {
  if (!expected) return false
  return timingSafeEqual(digest(expected), digest(presented))
}

function digest(value: string): Buffer {
  return createHash('sha256').update(value).digest()
}
