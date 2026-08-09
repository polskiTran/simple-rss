import { describe, expect, it } from 'vitest'
import type { CadenceObservation } from '../../src/shared/api.js'
import { cadenceDayLabel, cadenceGrid, cadenceLevel } from '../../src/client/cadence.js'

const DAY_MS = 24 * 60 * 60 * 1_000

/** The window the server sends for today = 2026-08-08: Monday 2026-02-09 on. */
function window(counts: Record<string, number> = {}, days = 181, start = '2026-02-09'): CadenceObservation[] {
  const opening = Date.parse(`${start}T00:00:00.000Z`)
  return Array.from({ length: days }, (_, index) => {
    const date = new Date(opening + index * DAY_MS).toISOString().slice(0, 10)
    return { date, count: counts[date] ?? 0 }
  })
}

describe('the four ink levels', () => {
  it('maps counts to silence, one, a few, busy, and peak — never more levels', () => {
    expect([0, 1, 2, 3, 4, 7, 8, 40].map(cadenceLevel)).toEqual([0, 1, 2, 2, 3, 3, 4, 4])
  })
})

describe('the cadence grid', () => {
  it('draws 26 columns of Monday-to-Sunday cells, oldest to newest, ending today', () => {
    const grid = cadenceGrid(window({ '2026-08-08': 2 }))

    expect(grid.columns).toHaveLength(26)
    expect(grid.columns.slice(0, 25).every((column) => column.cells.length === 7)).toBe(true)
    // Today is a Saturday, so the newest column holds six days and stops.
    expect(grid.columns.at(-1)?.cells).toHaveLength(6)
    expect(grid.columns[0]?.cells[0]).toMatchObject({ date: '2026-02-09', count: 0, level: 0 })
    expect(grid.columns.at(-1)?.cells.at(-1)).toMatchObject({ date: '2026-08-08', count: 2, level: 2 })
  })

  it('announces months where a column opens one, never crowding the labels', () => {
    const grid = cadenceGrid(window())

    const labelled = grid.columns
      .map((column, index) => (column.monthLabel ? [index, column.monthLabel] : undefined))
      .filter((entry) => entry !== undefined)
    expect(labelled).toEqual([
      [0, 'february'],
      [8, 'april'],
      [16, 'june'],
      [25, 'august'],
    ])
  })

  it('is deterministic for a fixed dataset', () => {
    const days = window({ '2026-06-03': 2, '2026-08-08': 1 })
    expect(cadenceGrid(days)).toEqual(cadenceGrid(days))
  })
})

describe('the one-line statistics', () => {
  it('derives the post count, busiest weekday, and longest quiet stretch from the observations', () => {
    const { stats } = cadenceGrid(
      window({ '2026-06-03': 2, '2026-08-06': 1, '2026-08-07': 1, '2026-08-08': 1 }),
    )

    // 2026-06-03 is a Wednesday; the quiet stretch is Feb 9 through Jun 2.
    expect(stats).toBe('5 posts in 26 weeks · busiest on wednesdays · longest quiet stretch 114 days')
  })

  it('says a quiet Feed has no posts, without a chart or an alarm', () => {
    expect(cadenceGrid(window()).stats).toBe('no posts in 26 weeks')
  })

  it('speaks in singulars when there is one post or one quiet day', () => {
    const { stats } = cadenceGrid(window({ '2026-02-09': 1 }, 2))
    expect(stats).toBe('1 post in 26 weeks · busiest on mondays · longest quiet stretch 1 day')
  })

  it('breaks a busiest-weekday tie toward the earlier weekday, deterministically', () => {
    const { stats } = cadenceGrid(window({ '2026-02-12': 2, '2026-02-11': 2 }, 14))
    expect(stats).toContain('busiest on wednesdays')
  })

  it('drops the quiet stretch once every day has a post', () => {
    const counts = Object.fromEntries(window({}, 14).map(({ date }) => [date, 1]))
    expect(cadenceGrid(window(counts, 14)).stats).toBe('14 posts in 26 weeks · busiest on mondays')
  })
})

describe('a represented day', () => {
  it('is described for a screen reader with its count and calendar day', () => {
    expect(cadenceDayLabel({ date: '2026-06-03', count: 2, level: 2 })).toBe('2 posts on 3 june 2026')
    expect(cadenceDayLabel({ date: '2026-08-08', count: 1, level: 1 })).toBe('1 post on 8 august 2026')
  })
})
