import type { Clock } from '../../src/server/clock.js'

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
