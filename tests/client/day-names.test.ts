import { describe, expect, it } from 'vitest'
import { shortHeadingDay } from '../../src/client/day-names.js'

describe('shortHeadingDay', () => {
  it('cuts the weekday and month to three letters, September included', () => {
    expect(shortHeadingDay('2026-09-17', '2026-11-13')).toBe('Thu 17 Sep')
  })

  it('keeps the year of a day from another year', () => {
    expect(shortHeadingDay('2025-12-31', '2026-11-13')).toBe('Wed 31 Dec 2025')
  })
})
