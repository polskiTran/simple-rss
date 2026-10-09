import { describe, expect, it } from 'vitest'
import { nextPollTime, nextRetryTime } from '../../../src/server/subscriptions/polling-schedule.js'

const FROM = new Date('2026-08-08T09:00:00.000Z')

function minutesAfterFrom(iso: string): number {
  return (Date.parse(iso) - FROM.getTime()) / 60_000
}

describe('next poll', () => {
  it.each([
    [30, 3],
    [120, 12],
    [1440, 15],
  ])('waits a %i-minute interval plus jitter under %i minutes', (interval, jitterCap) => {
    for (const feedId of [1, 17, 903]) {
      const wait = minutesAfterFrom(nextPollTime(feedId, interval, FROM))
      expect(wait).toBeGreaterThanOrEqual(interval)
      expect(wait).toBeLessThan(interval + jitterCap)
    }
  })

  it('spreads Feeds that share a preset instead of polling them in one burst', () => {
    const times = new Set(Array.from({ length: 10 }, (_, index) => nextPollTime(index + 1, 120, FROM)))
    expect(times.size).toBeGreaterThan(5)
  })
})

describe('retry after failures', () => {
  it('waits one ordinary interval after the first failure', () => {
    const wait = minutesAfterFrom(nextRetryTime(7, 120, 1, FROM))
    expect(wait).toBeGreaterThanOrEqual(120)
    expect(wait).toBeLessThan(132)
  })

  it('doubles the wait with each further failure', () => {
    for (const [failures, minutes] of [
      [2, 240],
      [3, 480],
    ] as const) {
      const wait = minutesAfterFrom(nextRetryTime(7, 120, failures, FROM))
      expect(wait).toBeGreaterThanOrEqual(minutes)
      expect(wait).toBeLessThan(minutes + 15)
    }
  })

  it('never waits longer than 24 hours, jitter included', () => {
    for (const feedId of [1, 7, 903]) {
      expect(minutesAfterFrom(nextRetryTime(feedId, 120, 5, FROM))).toBe(24 * 60)
      expect(minutesAfterFrom(nextRetryTime(feedId, 1440, 1, FROM))).toBe(24 * 60)
      expect(minutesAfterFrom(nextRetryTime(feedId, 30, 1_000, FROM))).toBe(24 * 60)
    }
  })
})
