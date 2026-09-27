import { describe, expect, it } from 'vitest'
import { cadenceDayLabel, cadenceGrid, cadenceLevel } from '../../src/client/cadence.js'
import { cadenceWindow } from './cadence-window.js'

describe('the four ink levels', () => {
  it('maps counts to silence, one, a few, busy, and peak — never more levels', () => {
    expect([0, 1, 2, 3, 4, 7, 8, 40].map(cadenceLevel)).toEqual([0, 1, 2, 2, 3, 3, 4, 4])
  })
})

describe('the cadence grid', () => {
  it('draws 26 columns of Monday-to-Sunday cells, oldest to newest, ending today', () => {
    const grid = cadenceGrid(cadenceWindow({ '2026-08-08': 2 }))

    expect(grid.columns).toHaveLength(26)
    expect(grid.columns.slice(0, 25).every((column) => column.cells.length === 7)).toBe(true)
    expect(grid.columns.at(-1)?.cells).toHaveLength(6)
    expect(grid.columns[0]?.cells[0]).toMatchObject({ date: '2026-02-09', count: 0, level: 0 })
    expect(grid.columns.at(-1)?.cells.at(-1)).toMatchObject({ date: '2026-08-08', count: 2, level: 2 })
  })

  it('announces months where a column opens one, never crowding the labels', () => {
    const grid = cadenceGrid(cadenceWindow())

    const labelled = grid.columns
      .map((column, index) => (column.monthLabel ? [index, column.monthLabel] : undefined))
      .filter((entry) => entry !== undefined)
    expect(labelled).toEqual([
      [0, 'Feb'],
      [8, 'Apr'],
      [16, 'Jun'],
      [25, 'Aug'],
    ])
  })

  it('is deterministic for a fixed dataset', () => {
    const days = cadenceWindow({ '2026-06-03': 2, '2026-08-08': 1 })
    expect(cadenceGrid(days)).toEqual(cadenceGrid(days))
  })
})

describe('the statistics', () => {
  it('derives the item count, busiest weekday, and longest quiet stretch from the observations', () => {
    const { stats } = cadenceGrid(cadenceWindow({ '2026-06-03': 2, '2026-08-06': 1, '2026-08-07': 1, '2026-08-08': 1 }))

    expect(stats).toEqual({ total: 5, busiestWeekday: 'Wednesday', longestQuiet: 114 })
  })

  it('names no busiest day for a Feed that published nothing', () => {
    expect(cadenceGrid(cadenceWindow()).stats).toEqual({ total: 0, busiestWeekday: undefined, longestQuiet: 181 })
  })

  it('breaks a busiest-weekday tie toward the earlier weekday, Monday first', () => {
    expect(cadenceGrid(cadenceWindow({ '2026-02-12': 2, '2026-02-11': 2 }, 14)).stats.busiestWeekday).toBe('Wednesday')
    expect(cadenceGrid(cadenceWindow({ '2026-02-15': 2, '2026-02-09': 2 }, 14)).stats.busiestWeekday).toBe('Monday')
  })

  it('has no quiet stretch once every day has an item', () => {
    const counts = Object.fromEntries(cadenceWindow({}, 14).map(({ date }) => [date, 1]))
    expect(cadenceGrid(cadenceWindow(counts, 14)).stats.longestQuiet).toBe(0)
  })
})

describe('a represented day', () => {
  it('is described for a screen reader with its count and calendar day', () => {
    expect(cadenceDayLabel({ date: '2026-06-03', count: 2, level: 2 })).toBe('2 items on 3 June 2026')
    expect(cadenceDayLabel({ date: '2026-08-08', count: 1, level: 1 })).toBe('1 item on 8 August 2026')
  })
})
