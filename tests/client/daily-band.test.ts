import { describe, expect, it } from 'vitest'
import { dailyShadows } from '../../src/client/components/daily-band.js'

/**
 * The band is decoration with a source, so its properties are testable: the
 * same morning always draws the same field, two mornings never repeat, and
 * the day's volume — not chance — sets how much ink it carries.
 */
describe('the daily band field', () => {
  it('draws one date and volume identically every time', () => {
    expect(dailyShadows('2026-08-08', 14, 708, 114)).toBe(dailyShadows('2026-08-08', 14, 708, 114))
  })

  it('is seeded by the date, so two mornings never repeat', () => {
    expect(dailyShadows('2026-08-08', 14, 708, 114)).not.toBe(dailyShadows('2026-08-09', 14, 708, 114))
  })

  it('derives its ink from the day volume, bounded rather than unbounded', () => {
    const inkDots = (volume: number) =>
      dailyShadows('2026-08-08', volume, 708, 114)
        .split(',')
        .filter((shadow) => !shadow.endsWith('var(--band-0)')).length

    const quiet = inkDots(0)
    const ordinary = inkDots(14)
    const torrent = inkDots(10_000)

    expect(quiet).toBeLessThan(ordinary)
    expect(ordinary).toBeLessThan(torrent)
    // The ink term saturates, so a torrent of posts cannot black the band
    // out: of the 142 × 23 dots, some must still rest at the quietest level.
    expect(torrent).toBeLessThan(142 * 23)
  })

  it('keeps every dot on the 5px pitch, inside the field, at four ink levels', () => {
    const shadows = dailyShadows('2026-08-08', 14, 708, 114).split(',')

    // 142 columns by 23 rows: the paper's full 708px content width, clipped by the container.
    expect(shadows).toHaveLength(142 * 23)
    for (const shadow of shadows) {
      const match = /^(\d+)px (\d+)px 0 var\(--band-([0-3])\)$/.exec(shadow)
      expect(match, shadow).not.toBeNull()
      expect(Number(match?.[1]) % 5).toBe(0)
      expect(Number(match?.[1])).toBeLessThan(708)
      expect(Number(match?.[2]) % 5).toBe(0)
      expect(Number(match?.[2])).toBeLessThan(114)
    }
  })
})
