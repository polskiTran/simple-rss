import type { Clock } from '../clock.js'

/** How far back a failed attempt still counts against a client. */
export const WINDOW_MS = 15 * 60 * 1000

/** Failed attempts one client address may make inside the window. */
export const PER_CLIENT_FAILURES = 5

export const GLOBAL_FAILURES = 20

const BASE_DELAY_MS = 250

const MAX_DELAY_MS = 2_000

export type AttemptVerdict =
  | {
      readonly kind: 'allowed'
      /** What a successful secret check costs, based on pressure already present. */
      readonly successDelayMs: number
      /** Keeps the reservation as a failure and returns this attempt's delay. */
      recordFailure(): number
      /** Clears this client's history after it proves it is the User. */
      recordSuccess(): void
      /** Releases the reservation when the secret check could not finish. */
      cancel(): void
    }
  | { readonly kind: 'refused'; readonly delayMs: number; readonly retryAfterSeconds: number }

export type AllowedAttempt = Extract<AttemptVerdict, { kind: 'allowed' }>

/**
 * Counts failed secret checks per client address inside a sliding window.
 *
 * `begin` records the attempt's start time before the secret is checked, so
 * concurrent checks cannot exceed the limit; that record *is* the failure, and
 * a failure is measured from when its attempt began. The first outcome wins:
 * failure keeps the record, cancel removes it, success forgets the client.
 */
export class LoginRateLimiter {
  /** Start times per client, oldest first. */
  readonly #attempts = new Map<string, number[]>()
  readonly #clock: Clock

  constructor(clock: Clock) {
    this.#clock = clock
  }

  /** Reserves one attempt before its secret is checked. */
  begin(client: string): AttemptVerdict {
    const now = this.#clock.now().getTime()
    const recent = this.#recent(client, now)
    const decisive = recent.at(-PER_CLIENT_FAILURES)

    if (decisive !== undefined && decisive + WINDOW_MS > now) {
      return {
        kind: 'refused',
        delayMs: MAX_DELAY_MS,
        retryAfterSeconds: Math.ceil((decisive + WINDOW_MS - now) / 1000),
      }
    }

    const successDelayMs = this.#cost(recent.length, now)
    recent.push(now)
    this.#attempts.set(client, recent)
    const failureDelayMs = this.#cost(recent.length, now)
    let open = true
    const settle = (): boolean => {
      const first = open
      open = false
      return first
    }

    return {
      kind: 'allowed',
      successDelayMs,
      recordFailure: () => {
        settle()
        return failureDelayMs
      },
      recordSuccess: () => {
        if (settle()) this.#attempts.delete(client)
      },
      cancel: () => {
        if (settle()) this.#release(client, now)
      },
    }
  }

  /** Drops one reservation. Records are bare start times, so any one equal to `at` is the same record. */
  #release(client: string, at: number): void {
    const kept = this.#attempts.get(client)
    const index = kept?.indexOf(at) ?? -1
    if (index !== -1) kept?.splice(index, 1)
  }

  #cost(clientAttempts: number, now: number): number {
    const pressure = this.#allRecentCount(now) >= GLOBAL_FAILURES ? MAX_DELAY_MS : 0
    return Math.max(delayFor(clientAttempts), pressure)
  }

  #recent(client: string, now: number): number[] {
    const kept = (this.#attempts.get(client) ?? []).filter((at) => at > now - WINDOW_MS)
    if (kept.length === 0) this.#attempts.delete(client)
    else this.#attempts.set(client, kept)
    return kept
  }

  #allRecentCount(now: number): number {
    let count = 0
    for (const client of this.#attempts.keys()) count += this.#recent(client, now).length
    return count
  }
}

function delayFor(attempts: number): number {
  if (attempts <= 0) return 0
  return Math.min(BASE_DELAY_MS * 2 ** (attempts - 1), MAX_DELAY_MS)
}
