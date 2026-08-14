export type Sleeper = (milliseconds: number) => Promise<void>

export const realSleeper: Sleeper = (milliseconds) =>
  milliseconds <= 0 ? Promise.resolve() : new Promise((resolve) => setTimeout(resolve, milliseconds))
