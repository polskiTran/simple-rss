import { describe, expect, it } from 'vitest'
import { rhythmOf } from '../../src/shared/rhythm.js'

const days = (active: number, perDay = 1) => Array.from({ length: 30 }, (_, index) => (index < active ? perDay : 0))

describe('Rhythm', () => {
  it.each([
    [15, 'daily'],
    [14, 'weekly'],
    [4, 'weekly'],
    [3, 'monthly'],
    [1, 'monthly'],
    [0, 'inactive'],
  ] as const)('reads %i active days of 30 as %s', (active, rhythm) => {
    expect(rhythmOf(days(active))).toBe(rhythm)
  })

  it('counts days with items, not items — one busy day is not a daily habit', () => {
    expect(rhythmOf(days(1, 40))).toBe('monthly')
  })
})
