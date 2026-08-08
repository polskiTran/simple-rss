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

export interface AttemptVerdict {
  /** Whether the password may be checked at all. */
  readonly allowed: boolean
  /** How long to hold a rejection before answering. */
  readonly delayMs: number
  /** Seconds until the client may try again. Zero unless blocked. */
  readonly retryAfterSeconds: number
}

/**
 * Local, in-memory guessing resistance for the routes that check a secret. No
 * Redis, because there is one process by design.
 *
 * The two limits deliberately work differently. Only a client's *own* failures
 * can block it; the installation-wide ceiling slows everyone down but blocks
 * nobody. That asymmetry is the point: a hard global block would let anyone
 * with a handful of addresses keep the Owner out of their own reader by
 * failing twenty sign-ins every quarter of an hour, which is exactly the
 * permanent lockout this is supposed to avoid. Spread-out guessing is answered
 * by capping the rate instead — every attempt costs the maximum delay on top
 * of a memory-hard verify, and each address still gets only five tries.
 *
 * State is deliberately not persisted. Losing it costs an attacker nothing
 * they could not get by waiting out the window, and only the Owner can restart
 * the process in the first place.
 */
export class LoginRateLimiter {
  readonly #failures = new Map<string, number[]>()
  readonly #clock: Clock

  constructor(clock: Clock) {
    this.#clock = clock
  }

  /**
   * Whether this client may attempt now, and what the attempt should cost.
   *
   * The delay is charged against failures already recorded, so the first
   * attempt after a quiet period is answered at full speed and a run of wrong
   * guesses gets progressively slower. Once the installation-wide ceiling is
   * reached, every attempt pays the maximum whatever its own history.
   */
  check(client: string): AttemptVerdict {
    const now = this.#clock.now().getTime()
    const clientFailures = this.#recent(client, now)
    const blockedUntil = deadline(clientFailures, PER_CLIENT_FAILURES)

    if (blockedUntil > now) {
      return {
        allowed: false,
        delayMs: MAX_DELAY_MS,
        retryAfterSeconds: Math.ceil((blockedUntil - now) / 1000),
      }
    }

    return {
      allowed: true,
      delayMs: this.#cost(clientFailures.length, now),
      retryAfterSeconds: 0,
    }
  }

  /** Records a wrong secret. Returns what this attempt should now cost. */
  recordFailure(client: string): number {
    const now = this.#clock.now().getTime()
    const recent = this.#recent(client, now)
    recent.push(now)
    this.#failures.set(client, recent)
    return this.#cost(recent.length, now)
  }

  /** Clears this client's history, because the Owner has just proved itself. */
  recordSuccess(client: string): void {
    this.#failures.delete(client)
  }

  /**
   * What an attempt costs in delay: whatever this client's own history has
   * earned, or the maximum once the installation as a whole is past its
   * ceiling — whichever is worse.
   */
  #cost(clientFailures: number, now: number): number {
    const pressure = this.#allRecent(now).length >= GLOBAL_FAILURES ? MAX_DELAY_MS : 0
    return Math.max(delayFor(clientFailures), pressure)
  }

  /** Failures still inside the window for one client, oldest first. */
  #recent(client: string, now: number): number[] {
    const kept = (this.#failures.get(client) ?? []).filter((at) => at > now - WINDOW_MS)
    if (kept.length === 0) this.#failures.delete(client)
    else this.#failures.set(client, kept)
    return kept
  }

  /** Failures still inside the window across every client, oldest first. */
  #allRecent(now: number): number[] {
    return [...this.#failures.keys()].flatMap((client) => this.#recent(client, now)).sort((a, b) => a - b)
  }
}

/**
 * When a window holding `limit` or more failures next drops below the limit —
 * that is, when the attempt that pushed it over ages out.
 */
function deadline(failures: readonly number[], limit: number): number {
  if (failures.length < limit) return 0
  const decisive = failures[failures.length - limit]
  return decisive === undefined ? 0 : decisive + WINDOW_MS
}

function delayFor(failures: number): number {
  if (failures <= 0) return 0
  return Math.min(BASE_DELAY_MS * 2 ** (failures - 1), MAX_DELAY_MS)
}
