/**
 * When a Subscription is next due. The schedule is a pure function of the Feed
 * and the instant an attempt finished, so a restart recomputes exactly what was
 * persisted rather than inventing a new timetable.
 */

/** Jitter never exceeds a tenth of the interval, and never a quarter hour. */
const JITTER_CAP_MS = 15 * 60_000

/**
 * A deterministic per-Feed offset inside `[0, interval / 10)`. Subscriptions
 * sharing a preset land on different instants instead of one synchronized
 * burst, and the same Feed lands on the same offset after every restart.
 */
export function pollingJitterMs(feedId: number, intervalMinutes: number): number {
  const windowMs = Math.min(Math.floor((intervalMinutes * 60_000) / 10), JITTER_CAP_MS)
  return hash32(feedId) % windowMs
}

/** The instant one interval plus jitter after `from`, as a stored ISO string. */
export function nextPollTime(feedId: number, intervalMinutes: number, from: Date): string {
  return new Date(from.getTime() + intervalMinutes * 60_000 + pollingJitterMs(feedId, intervalMinutes)).toISOString()
}

/** No failing Subscription waits longer than a day between attempts. */
export const MAX_BACKOFF_MINUTES = 24 * 60

/**
 * How long to wait after `consecutiveFailures` failures in a row: the ordinary
 * Polling Interval for the first, doubling with each further failure, capped
 * at a day. The doubling saturates to the cap, so an arbitrarily long outage
 * cannot overflow the arithmetic.
 */
export function backoffMinutes(intervalMinutes: number, consecutiveFailures: number): number {
  const doubled = intervalMinutes * 2 ** Math.max(0, consecutiveFailures - 1)
  return Math.min(doubled, MAX_BACKOFF_MINUTES)
}

/**
 * When to try a failing Subscription again: the backoff plus this Feed's
 * ordinary jitter, except that the whole wait — jitter included — is clamped
 * to the 24-hour cap, because "never more than a day" is the promise.
 */
export function nextRetryTime(
  feedId: number,
  intervalMinutes: number,
  consecutiveFailures: number,
  from: Date,
): string {
  const waitMinutes = backoffMinutes(intervalMinutes, consecutiveFailures)
  const waitMs = Math.min(
    waitMinutes * 60_000 + pollingJitterMs(feedId, waitMinutes),
    MAX_BACKOFF_MINUTES * 60_000,
  )
  return new Date(from.getTime() + waitMs).toISOString()
}

/** Finalizer of splitmix-style mixing: small consecutive ids scatter widely. */
function hash32(value: number): number {
  let mixed = value >>> 0
  mixed = Math.imul(mixed ^ (mixed >>> 16), 0x45d9f3b)
  mixed = Math.imul(mixed ^ (mixed >>> 16), 0x45d9f3b)
  mixed ^= mixed >>> 16
  return mixed >>> 0
}
