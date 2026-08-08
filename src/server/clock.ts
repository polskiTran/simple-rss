/**
 * The service never calls `new Date()` directly. Polling due times, session
 * expiry, and Digest grouping are all time-dependent, so time arrives as a
 * dependency that tests can drive.
 */
export interface Clock {
  now(): Date
}

export const systemClock: Clock = {
  now: () => new Date(),
}
