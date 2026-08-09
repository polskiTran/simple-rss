import type { Clock } from '../../src/server/clock.js'

/**
 * Time under test control. Polling due times, backoff, session expiry, and
 * Digest date grouping are all driven from here, so a test states the instant
 * it cares about instead of sleeping.
 */
export class ManualClock implements Clock {
  #current: Date

  constructor(start: Date | string = '2026-08-08T09:00:00.000Z') {
    this.#current = new Date(start)
  }

  now(): Date {
    return new Date(this.#current)
  }

  advance(milliseconds: number): void {
    this.#current = new Date(this.#current.getTime() + milliseconds)
  }
}
