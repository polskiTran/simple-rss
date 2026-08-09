/**
 * Deliberate delay, as a dependency.
 *
 * The login route slows down under guessing, which is a real wait in
 * production and must not be one under test — a suite that actually paused for
 * seconds would be a suite nobody runs. Tests substitute a recorder and assert
 * on the delays that were asked for.
 */
export type Sleeper = (milliseconds: number) => Promise<void>

export const realSleeper: Sleeper = (milliseconds) =>
  milliseconds <= 0 ? Promise.resolve() : new Promise((resolve) => setTimeout(resolve, milliseconds))
