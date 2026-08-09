import { CADENCE_GRID_WEEKS, type CadenceObservation } from '../shared/api.js'

/**
 * The opened Feed's cadence grid, derived from the server's day-by-day
 * observations. Everything here is a pure function of that array, so a fixed
 * dataset always renders the same columns, labels, and statistics.
 */

export interface CadenceCell {
  readonly date: string
  readonly count: number
  readonly level: 0 | 1 | 2 | 3 | 4
}

/** One week of the grid. The last column ends on today and may be short. */
export interface CadenceColumn {
  readonly cells: readonly CadenceCell[]
  /** The month beginning at this column, when the grid announces it. */
  readonly monthLabel: string | undefined
}

export interface CadenceGrid {
  readonly columns: readonly CadenceColumn[]
  /** The one-line statistic under the grid. */
  readonly stats: string
}

/**
 * The four ink levels — never more. Zero is silence, and the counts between
 * the thresholds share a level so the grid reads as rhythm, not as a chart.
 */
export function cadenceLevel(count: number): 0 | 1 | 2 | 3 | 4 {
  if (count === 0) return 0
  if (count === 1) return 1
  if (count <= 3) return 2
  if (count <= 7) return 3
  return 4
}

/**
 * Columns run left (oldest) to right (newest); rows run Monday to Sunday, the
 * alignment the server's Monday-opened window guarantees.
 */
export function cadenceGrid(days: readonly CadenceObservation[]): CadenceGrid {
  const columns: { cells: CadenceCell[]; monthLabel: string | undefined }[] = []
  for (let start = 0; start < days.length; start += 7) {
    columns.push({
      cells: days.slice(start, start + 7).map(({ date, count }) => ({ date, count, level: cadenceLevel(count) })),
      monthLabel: undefined,
    })
  }

  // A month is announced where a column first opens in it, but never crowded:
  // a label keeps at least six columns from the one before, which is what
  // spaces the reference render's `february · april · june · august`.
  let lastLabelled: number | undefined
  for (const [index, column] of columns.entries()) {
    const month = monthOf(column.cells[0]?.date)
    const previous = monthOf(columns[index - 1]?.cells[0]?.date)
    if (month === undefined) continue
    if (index > 0 && (month === previous || (lastLabelled !== undefined && index - lastLabelled < 6))) continue
    column.monthLabel = MONTHS[month]
    lastLabelled = index
  }

  return { columns, stats: statsOf(days) }
}

/** A represented day, said for a screen reader: `3 posts on 3 june 2026`. */
export function cadenceDayLabel(cell: CadenceCell): string {
  const [year, month, day] = cell.date.split('-')
  const monthName = MONTHS[Number(month) - 1] ?? ''
  return `${counted(cell.count, 'post')} on ${Number(day)} ${monthName} ${year}`
}

function statsOf(days: readonly CadenceObservation[]): string {
  const total = days.reduce((sum, { count }) => sum + count, 0)
  if (total === 0) return `no posts in ${CADENCE_GRID_WEEKS} weeks`

  const clauses = [`${counted(total, 'post')} in ${CADENCE_GRID_WEEKS} weeks`]

  const byWeekday = Array.from({ length: 7 }, () => 0)
  for (const [index, { count }] of days.entries()) byWeekday[index % 7] = (byWeekday[index % 7] ?? 0) + count
  const busiest = byWeekday.indexOf(Math.max(...byWeekday))
  clauses.push(`busiest on ${WEEKDAYS[busiest]}s`)

  let quiet = 0
  let longestQuiet = 0
  for (const { count } of days) {
    quiet = count === 0 ? quiet + 1 : 0
    longestQuiet = Math.max(longestQuiet, quiet)
  }
  if (longestQuiet > 0) clauses.push(`longest quiet stretch ${counted(longestQuiet, 'day')}`)

  return clauses.join(' · ')
}

function monthOf(date: string | undefined): number | undefined {
  if (!date) return undefined
  return Number(date.slice(5, 7)) - 1
}

function counted(count: number, noun: string): string {
  return count === 1 ? `1 ${noun}` : `${count} ${noun}s`
}

const MONTHS = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
] as const

/** Row order is the window's: columns open on Monday. */
const WEEKDAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'] as const
