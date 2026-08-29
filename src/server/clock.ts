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
