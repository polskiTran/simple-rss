import type { Clock } from '../clock.js'

export const WINDOW_MS = 15 * 60 * 1000

export const PER_CLIENT_FAILURES = 5

/** Installation-wide failures past which every attempt pays the maximum delay. */
export const GLOBAL_FAILURES = 20

/** Installation-wide failures past which every attempt is refused, whoever sends it. */
export const GLOBAL_LIMIT = 100

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

interface Reservation {
  readonly client: string
  readonly at: number
}

/**
 * Counts failed secret checks inside a sliding window, per client address and
 * across the installation.
 *
 * `begin` records the attempt's start time before the secret is checked, so
 * concurrent checks cannot exceed either limit; that record *is* the failure,
 * and a failure is measured from when its attempt began. The first outcome
 * wins: failure keeps the record, cancel removes it, success forgets the client.
 *
 * Every record lives in one list, oldest first. `GLOBAL_LIMIT` refuses before
 * the list can grow past it, so however many addresses a caller rotates
 * through, memory and each `begin` stay bounded.
 */
export class LoginRateLimiter {
  #reservations: Reservation[] = []
  readonly #clock: Clock

  constructor(clock: Clock) {
    this.#clock = clock
  }

  begin(client: string): AttemptVerdict {
    const now = this.#clock.now().getTime()
    this.#reservations = this.#reservations.filter((reservation) => reservation.at > now - WINDOW_MS)
    const own = this.#reservations.filter((reservation) => reservation.client === client)
    const decisive = Math.max(
      own.at(-PER_CLIENT_FAILURES)?.at ?? Number.NEGATIVE_INFINITY,
      this.#reservations.at(-GLOBAL_LIMIT)?.at ?? Number.NEGATIVE_INFINITY,
    )

    if (decisive !== Number.NEGATIVE_INFINITY) {
      return {
        kind: 'refused',
        delayMs: MAX_DELAY_MS,
        retryAfterSeconds: Math.ceil((decisive + WINDOW_MS - now) / 1000),
      }
    }

    const successDelayMs = this.#cost(own.length)
    const reservation: Reservation = { client, at: now }
    this.#reservations.push(reservation)
    const failureDelayMs = this.#cost(own.length + 1)
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
        if (settle()) this.#reservations = this.#reservations.filter((kept) => kept.client !== client)
      },
      cancel: () => {
        if (settle()) this.#reservations = this.#reservations.filter((kept) => kept !== reservation)
      },
    }
  }

  #cost(clientAttempts: number): number {
    const pressure = this.#reservations.length >= GLOBAL_FAILURES ? MAX_DELAY_MS : 0
    return Math.max(delayFor(clientAttempts), pressure)
  }
}

function delayFor(attempts: number): number {
  if (attempts <= 0) return 0
  return Math.min(BASE_DELAY_MS * 2 ** (attempts - 1), MAX_DELAY_MS)
}
