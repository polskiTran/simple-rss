import { describe, expect, it } from 'vitest'
import { POLLING_INTERVAL_PRESETS } from '../../../src/shared/api.js'
import {
  MAX_BACKOFF_MINUTES,
  backoffMinutes,
  nextPollTime,
  nextRetryTime,
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

describe('failure backoff', () => {
  it('waits one ordinary interval after the first failure', () => {
    expect(backoffMinutes(120, 1)).toBe(120)
    expect(backoffMinutes(30, 1)).toBe(30)
  })

  it('doubles the wait with each further consecutive failure', () => {
    expect(backoffMinutes(120, 2)).toBe(240)
    expect(backoffMinutes(120, 3)).toBe(480)
    expect(backoffMinutes(30, 4)).toBe(240)
  })

  it('never waits longer than 24 hours', () => {
    expect(MAX_BACKOFF_MINUTES).toBe(24 * 60)
    expect(backoffMinutes(120, 5)).toBe(MAX_BACKOFF_MINUTES)
    expect(backoffMinutes(1440, 1)).toBe(MAX_BACKOFF_MINUTES)
    // A long outage cannot overflow the doubling into nonsense.
    expect(backoffMinutes(30, 1_000)).toBe(MAX_BACKOFF_MINUTES)
  })

  it('schedules a retry with jitter below the cap, and clamps jitter at the cap', () => {
    // Below the cap the retry is backoff plus this Feed's ordinary jitter.
    const early = Date.parse(nextRetryTime(7, 120, 2, FROM)) - FROM.getTime()
    expect(early).toBe(240 * 60_000 + pollingJitterMs(7, 240))

    // At the cap the 24 hours is the whole promise: jitter cannot stretch it.
    for (const feedId of [1, 7, 903]) {
      const capped = Date.parse(nextRetryTime(feedId, 120, 9, FROM)) - FROM.getTime()
      expect(capped).toBe(MAX_BACKOFF_MINUTES * 60_000)
    }
  })
})
