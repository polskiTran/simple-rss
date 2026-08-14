const JITTER_CAP_MS = 15 * 60_000

/**
 * Deterministic per-Feed offset in `[0, interval / 10)`: Subscriptions sharing a
 * preset spread out instead of bursting, and the offset survives restarts.
 */
export function pollingJitterMs(feedId: number, intervalMinutes: number): number {
  const windowMs = Math.min(Math.floor((intervalMinutes * 60_000) / 10), JITTER_CAP_MS)
  return hash32(feedId) % windowMs
}

export function nextPollTime(feedId: number, intervalMinutes: number, from: Date): string {
  return new Date(from.getTime() + intervalMinutes * 60_000 + pollingJitterMs(feedId, intervalMinutes)).toISOString()
}

export const MAX_BACKOFF_MINUTES = 24 * 60

export function backoffMinutes(intervalMinutes: number, consecutiveFailures: number): number {
  const doubled = intervalMinutes * 2 ** Math.max(0, consecutiveFailures - 1)
  return Math.min(doubled, MAX_BACKOFF_MINUTES)
}

export function nextRetryTime(
  feedId: number,
  intervalMinutes: number,
  consecutiveFailures: number,
  from: Date,
): string {
  const waitMinutes = backoffMinutes(intervalMinutes, consecutiveFailures)
  const waitMs = Math.min(waitMinutes * 60_000 + pollingJitterMs(feedId, waitMinutes), MAX_BACKOFF_MINUTES * 60_000)
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
