import { describe, expect, it } from 'vitest'
import { dateKey, dayKeysIn } from '../../../src/server/digest/chronology.js'

describe('dateKey', () => {
  it('names the calendar day in the installation timezone, not UTC', () => {
    const instant = new Date('2026-08-07T20:00:00.000Z')

    expect(dateKey(instant, 'UTC')).toBe('2026-08-07')
    expect(dateKey(instant, 'Pacific/Auckland')).toBe('2026-08-08')
    expect(dateKey(instant, 'America/New_York')).toBe('2026-08-07')
  })

  it('keeps the day stable across the spring-forward hour', () => {
    expect(dateKey(new Date('2026-03-08T06:59:00.000Z'), 'America/New_York')).toBe('2026-03-08')
    expect(dateKey(new Date('2026-03-08T07:00:00.000Z'), 'America/New_York')).toBe('2026-03-08')
  })

  it('keeps the day stable across the fall-back repeated hour', () => {
    expect(dateKey(new Date('2026-11-01T05:30:00.000Z'), 'America/New_York')).toBe('2026-11-01')
    expect(dateKey(new Date('2026-11-01T06:30:00.000Z'), 'America/New_York')).toBe('2026-11-01')
  })

  it('turns over at the timezone midnight on a DST transition day', () => {
    expect(dateKey(new Date('2026-11-01T03:59:00.000Z'), 'America/New_York')).toBe('2026-10-31')
    expect(dateKey(new Date('2026-11-01T04:00:00.000Z'), 'America/New_York')).toBe('2026-11-01')
  })
})

const YEAR_END = Date.parse('2027-01-01T00:00:00.000Z')
const QUARTER_HOUR_MS = 15 * 60 * 1_000

describe('dayKeysIn', () => {
  // Half- and quarter-hour offsets, the date line, and zones whose DST turns over at midnight.
  const zones = [
    'UTC',
    'America/New_York',
    'Asia/Kolkata',
    'Asia/Kathmandu',
    'Pacific/Chatham',
    'Pacific/Kiritimati',
    'America/Santiago',
    'America/Havana',
  ]

  it('names the same day as dateKey for every quarter hour of a year', () => {
    const disagreements: string[] = []
    for (const timezone of zones) {
      const keyOf = dayKeysIn(timezone)
      for (let time = Date.parse('2026-01-01T00:00:00.000Z'); time < YEAR_END; time += QUARTER_HOUR_MS) {
        const instant = new Date(time)
        if (keyOf(instant.toISOString()) !== dateKey(instant, timezone)) {
          disagreements.push(`${timezone} ${instant.toISOString()}`)
        }
      }
    }

    expect(disagreements).toEqual([])
  })
})
