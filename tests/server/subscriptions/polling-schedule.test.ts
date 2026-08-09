import { describe, expect, it } from 'vitest'
import { POLLING_INTERVAL_PRESETS } from '../../../src/shared/api.js'
import {
  nextPollTime,
  pollingJitterMs,
} from '../../../src/server/subscriptions/polling-schedule.js'

const FROM = new Date('2026-08-08T09:00:00.000Z')

describe('polling schedule', () => {
  it('schedules the next poll one interval plus deterministic jitter after the anchor', () => {
    for (const interval of POLLING_INTERVAL_PRESETS) {
      const next = Date.parse(nextPollTime(7, interval, FROM))
      const offset = next - FROM.getTime() - interval * 60_000

      expect(offset).toBe(pollingJitterMs(7, interval))
      expect(offset).toBeGreaterThanOrEqual(0)
    }
  })

  it('derives the same jitter every time, so restarts cannot move a schedule', () => {
    for (const feedId of [1, 2, 3, 500, 12_345]) {
      expect(pollingJitterMs(feedId, 120)).toBe(pollingJitterMs(feedId, 120))
      expect(nextPollTime(feedId, 120, FROM)).toBe(nextPollTime(feedId, 120, FROM))
    }
  })

  it('spreads Feeds that share a preset instead of polling them in one burst', () => {
    const offsets = new Set(
      Array.from({ length: 10 }, (_, index) => pollingJitterMs(index + 1, 120)),
    )
    expect(offsets.size).toBeGreaterThan(5)
  })

  it('keeps jitter a small fraction of the interval, capped for the daily preset', () => {
    for (const interval of POLLING_INTERVAL_PRESETS) {
      for (const feedId of [1, 17, 903]) {
        const jitter = pollingJitterMs(feedId, interval)
        expect(jitter).toBeLessThan(Math.min((interval * 60_000) / 10, 15 * 60_000))
      }
    }
  })
})
