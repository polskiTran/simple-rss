import { describe, expect, it } from 'vitest'
import { chronologyTime, dateKey } from '../../../src/server/digest/chronology.js'

const NOW = new Date('2026-08-08T09:00:00.000Z')
const FIRST_SEEN = '2026-08-08T06:00:00.000Z'

describe('chronologyTime', () => {
  it('orders by a valid publication time', () => {
    expect(chronologyTime('2026-08-01T12:00:00.000Z', FIRST_SEEN, NOW)).toBe(
      Date.parse('2026-08-01T12:00:00.000Z'),
    )
  })

  it('falls back to first-seen when the publication time is missing', () => {
    expect(chronologyTime(null, FIRST_SEEN, NOW)).toBe(Date.parse(FIRST_SEEN))
  })

  it('falls back to first-seen when the publication time does not parse', () => {
    expect(chronologyTime('last thursday, probably', FIRST_SEEN, NOW)).toBe(Date.parse(FIRST_SEEN))
  })

  it('tolerates a publication up to a day ahead, for publisher clock drift', () => {
    const withinTolerance = new Date(NOW.getTime() + 24 * 60 * 60 * 1_000).toISOString()
    expect(chronologyTime(withinTolerance, FIRST_SEEN, NOW)).toBe(Date.parse(withinTolerance))
  })

  it('treats a date more than a day ahead as implausible and uses first-seen', () => {
    const implausible = new Date(NOW.getTime() + 24 * 60 * 60 * 1_000 + 1_000).toISOString()
    expect(chronologyTime(implausible, FIRST_SEEN, NOW)).toBe(Date.parse(FIRST_SEEN))
  })
})

describe('dateKey', () => {
  it('names the calendar day in the installation timezone, not UTC', () => {
    const instant = new Date('2026-08-07T20:00:00.000Z')

    expect(dateKey(instant, 'UTC')).toBe('2026-08-07')
    // 20:00 UTC on the 7th is already the morning of the 8th in Auckland.
    expect(dateKey(instant, 'Pacific/Auckland')).toBe('2026-08-08')
    // And still mid-afternoon of the 7th in New York.
    expect(dateKey(instant, 'America/New_York')).toBe('2026-08-07')
  })

  it('keeps the day stable across the spring-forward hour', () => {
    // US DST begins 2026-03-08 at 02:00 local; the skipped hour must not
    // displace either side of it into another calendar day.
    expect(dateKey(new Date('2026-03-08T06:59:00.000Z'), 'America/New_York')).toBe('2026-03-08')
    expect(dateKey(new Date('2026-03-08T07:00:00.000Z'), 'America/New_York')).toBe('2026-03-08')
  })

  it('keeps the day stable across the fall-back repeated hour', () => {
    // US DST ends 2026-11-01; 01:30 local happens twice, on both offsets.
    expect(dateKey(new Date('2026-11-01T05:30:00.000Z'), 'America/New_York')).toBe('2026-11-01')
    expect(dateKey(new Date('2026-11-01T06:30:00.000Z'), 'America/New_York')).toBe('2026-11-01')
  })

  it('turns over at the timezone midnight on a DST transition day', () => {
    // 23:59 EDT on October 31st against 00:00 EDT on November 1st.
    expect(dateKey(new Date('2026-11-01T03:59:00.000Z'), 'America/New_York')).toBe('2026-10-31')
    expect(dateKey(new Date('2026-11-01T04:00:00.000Z'), 'America/New_York')).toBe('2026-11-01')
  })
})
