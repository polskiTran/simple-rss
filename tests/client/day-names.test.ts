import { describe, expect, expectTypeOf, it } from 'vitest'
import { shortHeadingDay } from '../../src/client/day-names.js'
import type { DateKey } from '../../src/shared/api.js'
import { day } from './fixtures.js'

describe('shortHeadingDay', () => {
  it('cuts the weekday and month to three letters, September included', () => {
    expect(shortHeadingDay(day('2026-09-17'), day('2026-11-13'))).toBe('Thu 17 Sep')
  })

  it('keeps the year of a day from another year', () => {
    expect(shortHeadingDay(day('2025-12-31'), day('2026-11-13'))).toBe('Wed 31 Dec 2025')
  })
})

describe('DateKey', () => {
  it('is a day the server named, never a bare string', () => {
    expectTypeOf<string>().not.toMatchTypeOf<DateKey>()
  })
})
