/**
 * Time arrives as a dependency, never `new Date()` directly, so tests can
 * drive polling due times, Session expiry, and Digest grouping.
 */
export interface Clock {
  now(): Date
}

export const systemClock: Clock = {
  now: () => new Date(),
}

export function elapsedMs(startedAt: number, endedAt = performance.now()): number {
  return Math.max(0, Math.round((endedAt - startedAt) * 100) / 100)
}
