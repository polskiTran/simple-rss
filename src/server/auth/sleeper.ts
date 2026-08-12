// Deliberate delay as a dependency: the login route's guessing delays are real waits
// in production and must not be under test. Tests substitute a recorder and assert on
// the delays asked for.
export type Sleeper = (milliseconds: number) => Promise<void>

export const realSleeper: Sleeper = (milliseconds) =>
  milliseconds <= 0 ? Promise.resolve() : new Promise((resolve) => setTimeout(resolve, milliseconds))
