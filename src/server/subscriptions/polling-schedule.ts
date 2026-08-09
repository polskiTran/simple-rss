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

/** Finalizer of splitmix-style mixing: small consecutive ids scatter widely. */
function hash32(value: number): number {
  let mixed = value >>> 0
  mixed = Math.imul(mixed ^ (mixed >>> 16), 0x45d9f3b)
  mixed = Math.imul(mixed ^ (mixed >>> 16), 0x45d9f3b)
  mixed ^= mixed >>> 16
  return mixed >>> 0
}
