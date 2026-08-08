import type { Clock } from '../clock.js'

/** How far back a failed attempt still counts against a client. */
export const WINDOW_MS = 15 * 60 * 1000

/** Failed attempts one client address may make inside the window. */
export const PER_CLIENT_FAILURES = 5

/**
 * Failed attempts across every address before the installation as a whole
 * starts costing the maximum delay.
 *
 * The per-client limit alone does nothing against guessing spread over many
 * addresses, which is cheap to arrange. This ceiling is deliberately well
 * above anything the Owner would produce by mistyping.
 */
export const GLOBAL_FAILURES = 20

/** The first failure costs this long; each further one doubles it. */
const BASE_DELAY_MS = 250

/**
 * The delay stops growing here. Long enough to make automated guessing
 * pointless, short enough that a queue of held requests cannot itself become
 * the outage.
 */
const MAX_DELAY_MS = 2_000

export interface AllowedAttempt {
  readonly allowed: true
  /** What a successful secret check costs, based on pressure already present. */
  readonly successDelayMs: number
  readonly retryAfterSeconds: 0
  /** Converts the reservation into a failure and returns this attempt's delay. */
  recordFailure(): number
  /** Clears this client's history after it proves it is the Owner. */
  recordSuccess(): void
  /** Releases a reservation when the secret check could not finish. */
  cancel(): void
}

export interface RefusedAttempt {
  readonly allowed: false
  readonly delayMs: number
  readonly retryAfterSeconds: number
}

export type AttemptVerdict = AllowedAttempt | RefusedAttempt

interface AttemptRecord {
  readonly id: number
  at: number
}

type AttemptOutcome = 'failure' | 'success' | 'cancelled'

/**
 * Local, in-memory guessing resistance for the routes that check a secret. No
 * Redis, because there is one process by design.
 *
 * Pending checks reserve one of the client's five slots before the asynchronous
 * password verifier starts. A burst therefore cannot send an arbitrary number
 * of guesses through while every request still sees an empty failure history.
 *
 * The two limits deliberately work differently. Only a client's own attempts
 * can block it; the installation-wide ceiling slows everyone down but blocks
 * nobody. That asymmetry prevents strangers from locking the Owner out.
 */
export class LoginRateLimiter {
  readonly #attempts = new Map<string, AttemptRecord[]>()
  readonly #clock: Clock
  #nextId = 1

  constructor(clock: Clock) {
    this.#clock = clock
  }

  /**
   * Reserves one attempt before its secret is checked.
   *
   * A successful attempt pays for failures and global pressure already
   * present. A failed attempt also pays for the slot it just consumed.
   */
  begin(client: string): AttemptVerdict {
    const now = this.#clock.now().getTime()
    const recent = this.#recent(client, now)
    const blockedUntil = deadline(recent, PER_CLIENT_FAILURES)

    if (blockedUntil > now) {
      return {
        allowed: false,
        delayMs: MAX_DELAY_MS,
        retryAfterSeconds: Math.ceil((blockedUntil - now) / 1000),
      }
    }

    const successDelayMs = this.#cost(recent.length, now)
    const id = this.#nextId
    this.#nextId += 1
    recent.push({ id, at: now })
    this.#attempts.set(client, recent)
    const failureDelayMs = this.#cost(recent.length, now)
    let open = true

    const finish = (outcome: AttemptOutcome): void => {
      if (!open) return
      open = false
      this.#finish(client, id, outcome)
    }

    return {
      allowed: true,
      successDelayMs,
      retryAfterSeconds: 0,
      recordFailure: () => {
        finish('failure')
        return failureDelayMs
      },
      recordSuccess: () => finish('success'),
      cancel: () => finish('cancelled'),
    }
  }

  #finish(client: string, id: number, outcome: AttemptOutcome): void {
    if (outcome === 'success') {
      this.#attempts.delete(client)
      return
    }

    const now = this.#clock.now().getTime()
    const recent = this.#recent(client, now)
    const index = recent.findIndex((attempt) => attempt.id === id)

    if (outcome === 'failure') {
      const failed = index === -1 ? { id, at: now } : recent[index]
      if (!failed) return
      failed.at = now
      if (index === -1) recent.push(failed)
    } else if (index !== -1) {
      recent.splice(index, 1)
    }

    recent.sort((left, right) => left.at - right.at)
    if (recent.length === 0) this.#attempts.delete(client)
    else this.#attempts.set(client, recent)
  }

  /** What an attempt costs at the current client and installation pressure. */
  #cost(clientAttempts: number, now: number): number {
    const pressure = this.#allRecentCount(now) >= GLOBAL_FAILURES ? MAX_DELAY_MS : 0
    return Math.max(delayFor(clientAttempts), pressure)
  }

  /** Attempts still inside the window for one client, oldest first. */
  #recent(client: string, now: number): AttemptRecord[] {
    const kept = (this.#attempts.get(client) ?? []).filter((attempt) => attempt.at > now - WINDOW_MS)
    if (kept.length === 0) this.#attempts.delete(client)
    else this.#attempts.set(client, kept)
    return kept
  }

  /** Number of recent failed or pending attempts across every client. */
  #allRecentCount(now: number): number {
    let count = 0
    for (const client of this.#attempts.keys()) count += this.#recent(client, now).length
    return count
  }
}

/** When a full client window next has a free slot. */
function deadline(attempts: readonly AttemptRecord[], limit: number): number {
  if (attempts.length < limit) return 0
  const decisive = attempts[attempts.length - limit]
  return decisive === undefined ? 0 : decisive.at + WINDOW_MS
}

function delayFor(attempts: number): number {
  if (attempts <= 0) return 0
  return Math.min(BASE_DELAY_MS * 2 ** (attempts - 1), MAX_DELAY_MS)
}
