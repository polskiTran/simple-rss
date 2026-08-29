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

/**
 * Milliseconds between two `performance.now()` readings, rounded to hundredths
 * — the resolution diagnostics log. Monotonic, so unrelated to `Clock`'s
 * test-driven wall time: phase durations stay real even under a manual clock.
 */
export function elapsedMs(startedAt: number, endedAt = performance.now()): number {
  return Math.max(0, Math.round((endedAt - startedAt) * 100) / 100)
}
