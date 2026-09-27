import { describe, expect, it } from 'vitest'
import { itemAge } from '../../src/client/day-names.js'

describe('an item’s age', () => {
  it.each([
    ['2026-08-08', '07:15'],
    ['2026-08-07', 'Yesterday'],
    ['2026-08-02', 'Sun'],
    ['2026-08-01', '1 Aug'],
    ['2026-01-21', '21 Jan'],
    ['2025-12-30', '30 Dec 2025'],
  ])('reads %s as %s on 8 August 2026', (date, age) => {
    expect(itemAge(date, '07:15', '2026-08-08')).toBe(age)
  })
})
