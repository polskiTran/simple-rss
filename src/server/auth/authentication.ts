import { createHash, timingSafeEqual } from 'node:crypto'
import type { Clock } from '../clock.js'
import type { Logger } from '../logger.js'
import type { SqliteDatabase } from '../persistence/database.js'
import { OwnerAuthStore } from './owner-auth.js'
import { argon2idHasher, type PasswordHasher } from './password.js'
import { LoginRateLimiter } from './rate-limit.js'
import { SessionStore, type IssuedSession } from './sessions.js'
import { realSleeper, type Sleeper } from './sleeper.js'

/**
 * A setup secret shorter than this is treated as absent, because a guessable
 * one is worse than none: it looks like protection while letting a stranger
 * claim the installation.
 */
export const MIN_SETUP_SECRET_LENGTH = 16

export interface AuthenticationOptions {
  readonly owner: OwnerAuthStore
  readonly sessions: SessionStore
  readonly hasher: PasswordHasher
  readonly limiter: LoginRateLimiter
  readonly sleep: Sleeper
  readonly clock: Clock
  readonly logger: Logger
  /** From the deployment environment; absent on an unconfigured installation. */
  readonly setupSecret: string | undefined
}

/** Every route that checks a secret can be told to come back later. */
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

/** What a caller presents when it is about to spend an attempt at a secret. */
interface Attempt {
  /** The address the attempt is rate-limited against. */
  readonly client: string
}

export interface AuthenticationStatus {
  /** Whether an Owner has claimed this installation. */
  readonly claimed: boolean
  /** Whether the caller presented a live session. */
  readonly authenticated: boolean
}

/**
 * Everything the installation knows about who its Owner is: claiming it,
 * returning to it, leaving it, and recovering it.
 *
 * The HTTP routes above this are deliberately thin. They translate outcomes
 * into status codes and cookies; every rule about what is allowed — the setup
 * secret, the guessing limits, which sessions survive a password change —
 * lives here, where it can be read as one piece.
 */
export class Authentication {
  readonly #deps: AuthenticationOptions

  constructor(options: AuthenticationOptions) {
    this.#deps = options
  }

  status(token: string | undefined): AuthenticationStatus {
    return { claimed: this.#deps.owner.isClaimed(), authenticated: this.authenticate(token) }
  }

  /**
   * Why this installation cannot be claimed yet, or `undefined` when it can be
   * — or already has been. Readiness reads this, so a deployment that forgot
   * its setup secret never takes traffic it could not usefully answer.
   */
  setupBlocker(): string | undefined {
    if (this.#deps.owner.isClaimed()) return undefined

    const secret = this.#deps.setupSecret
    if (!secret) return 'setup secret is not configured'
    if (secret.length < MIN_SETUP_SECRET_LENGTH) return 'setup secret is too short'
    return undefined
  }

  /**
   * Claims the installation for the one Owner and signs their device in.
   *
   * The password is hashed before the claim is attempted, so two simultaneous
   * claims both reach the write with real work behind them and SQLite — not
   * the order they arrived in — decides which one is the Owner.
   */
  async claim(input: Attempt & { readonly setupSecret: string; readonly password: string }): Promise<ClaimOutcome> {
    const blocker = this.setupBlocker()
    if (blocker) {
      this.#deps.logger.warn('auth.setup_unavailable', { reason: blocker })
      return { kind: 'unavailable', reason: blocker }
    }

    if (this.#deps.owner.isClaimed()) return { kind: 'already-claimed' }

    const throttled = await this.#throttle(input.client, 'auth.claim_throttled')
    if (throttled) return throttled

    if (!matches(this.#deps.setupSecret, input.setupSecret)) {
      await this.#chargeFailure(input.client, 'auth.claim_rejected')
      return { kind: 'rejected' }
    }

    const passwordHash = await this.#deps.hasher.hash(input.password)
    const now = this.#deps.clock.now()

    if (!this.#deps.owner.claim(passwordHash, now)) {
      // Another request claimed it while this one was hashing. The setup
      // secret was valid, but it is spent: there is already an Owner.
      this.#deps.logger.warn('auth.claim_lost_race')
      return { kind: 'already-claimed' }
    }

    this.#deps.limiter.recordSuccess(input.client)
    this.#deps.logger.info('auth.claimed')
    return { kind: 'claimed', session: this.#deps.sessions.issue(now) }
  }

  /**
   * Signs a device in. Wrong passwords cost progressively more time and are
   * answered identically whether or not the installation has an Owner yet.
   */
  async signIn(input: Attempt & { readonly password: string }): Promise<SignInOutcome> {
    const throttled = await this.#throttle(input.client, 'auth.sign_in_throttled')
    if (throttled) return throttled

    if (!(await this.#accepts(input.password))) {
      await this.#chargeFailure(input.client, 'auth.sign_in_rejected')
      return { kind: 'rejected' }
    }

    this.#deps.limiter.recordSuccess(input.client)
    const now = this.#deps.clock.now()
    this.#deps.sessions.prune(now)
    this.#deps.logger.info('auth.signed_in', { client: input.client })

    return { kind: 'signed-in', session: this.#deps.sessions.issue(now) }
  }

  /** Whether this token is a live session, sliding its idle deadline. */
  authenticate(token: string | undefined): boolean {
    return token ? this.#deps.sessions.touch(token, this.#deps.clock.now()) : false
  }

  /** Ends this device's session and leaves every other device alone. */
  signOut(token: string | undefined): void {
    if (!token) return
    this.#deps.sessions.revoke(token)
    this.#deps.logger.info('auth.signed_out')
  }

  /**
   * Replaces the password for an Owner who knows the current one, and signs
   * every device out — including the one asking. A password is changed because
   * the old one might be known to someone else, and a session issued under it
   * is exactly as compromised as the password was.
   */
  async changePassword(
    input: Attempt & { readonly currentPassword: string; readonly newPassword: string },
  ): Promise<PasswordChangeOutcome> {
    const throttled = await this.#throttle(input.client, 'auth.password_change_throttled')
    if (throttled) return throttled

    if (!(await this.#accepts(input.currentPassword))) {
      await this.#chargeFailure(input.client, 'auth.password_change_rejected')
      return { kind: 'rejected' }
    }

    this.#deps.limiter.recordSuccess(input.client)
    const revoked = await this.#install(input.newPassword)
    this.#deps.logger.info('auth.password_changed', { sessionsRevoked: revoked })
    return { kind: 'changed', revoked }
  }

  /**
   * Emergency recovery, reached only through the platform shell. It answers
   * the case the rest of this module deliberately cannot: an Owner who has
   * forgotten the password and has no second Owner, no recovery email, and no
   * identity provider to fall back on.
   *
   * Knowing the current password is not required, because whoever can run this
   * already has the volume. Returns how many sessions it ended.
   */
  async resetPassword(newPassword: string): Promise<number> {
    const revoked = await this.#install(newPassword)
    this.#deps.logger.warn('auth.password_reset', { sessionsRevoked: revoked })
    return revoked
  }

  /** Installs a verifier and ends every session that predates it. */
  async #install(password: string): Promise<number> {
    const passwordHash = await this.#deps.hasher.hash(password)
    this.#deps.owner.replacePassword(passwordHash, this.#deps.clock.now())
    return this.#deps.sessions.revokeAll()
  }

  /** Whether this is the Owner's current password. False before setup. */
  async #accepts(password: string): Promise<boolean> {
    const record = this.#deps.owner.read()
    return record ? this.#deps.hasher.verify(record.passwordHash, password) : false
  }

  /**
   * The refusal to return when this client has spent its attempts, or
   * `undefined` when it may go ahead. Every route that checks a secret asks
   * this first, so the setup secret is no cheaper to guess than the password.
   */
  async #throttle(client: string, event: string): Promise<Throttled | undefined> {
    const verdict = this.#deps.limiter.check(client)
    if (verdict.allowed) return undefined

    this.#deps.logger.warn(event, { client, retryAfterSeconds: verdict.retryAfterSeconds })
    await this.#deps.sleep(verdict.delayMs)
    return { kind: 'rate-limited', retryAfterSeconds: verdict.retryAfterSeconds }
  }

  /** Records a wrong secret and holds the answer back for what it now costs. */
  async #chargeFailure(client: string, event: string): Promise<void> {
    const delayMs = this.#deps.limiter.recordFailure(client)
    this.#deps.logger.warn(event, { client })
    await this.#deps.sleep(delayMs)
  }
}

export interface AuthenticationDependencies {
  readonly database: SqliteDatabase
  readonly clock: Clock
  readonly logger: Logger
  readonly setupSecret: string | undefined
  /** Overridden by tests so progressive delays cost no wall-clock time. */
  readonly sleep?: Sleeper
}

/**
 * Assembles the module against one open database. Both the running service and
 * the recovery CLI go through here, so neither can wire up a differently
 * configured hasher or forget to sweep expired sessions.
 */
export function createAuthentication(deps: AuthenticationDependencies): Authentication {
  const sessions = new SessionStore(deps.database)

  // Sessions that idled or aged out while nothing was running are swept here
  // rather than left to linger until each is next presented.
  sessions.prune(deps.clock.now())

  return new Authentication({
    owner: new OwnerAuthStore(deps.database),
    sessions,
    hasher: argon2idHasher(),
    limiter: new LoginRateLimiter(deps.clock),
    sleep: deps.sleep ?? realSleeper,
    clock: deps.clock,
    logger: deps.logger,
    setupSecret: deps.setupSecret,
  })
}

/**
 * Compares two secrets without leaking how much of the presented one was
 * right. Both are digested first so the comparison length is fixed, which
 * keeps the length of the real secret out of the timing too.
 */
function matches(expected: string | undefined, presented: string): boolean {
  if (!expected) return false
  return timingSafeEqual(digest(expected), digest(presented))
}

function digest(value: string): Buffer {
  return createHash('sha256').update(value).digest()
}
