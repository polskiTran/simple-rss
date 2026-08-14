import { CADENCE_GRID_WEEKS, type CadenceObservation } from '../shared/api.js'

export interface CadenceCell {
  readonly date: string
  readonly count: number
  readonly level: 0 | 1 | 2 | 3 | 4
}

/** One week of the grid. The last column ends on today and may be short. */
export interface CadenceColumn {
  readonly cells: readonly CadenceCell[]
  readonly monthLabel: string | undefined
}

export interface CadenceGrid {
  readonly columns: readonly CadenceColumn[]
  readonly stats: string
}

export function cadenceLevel(count: number): 0 | 1 | 2 | 3 | 4 {
  if (count === 0) return 0
  if (count === 1) return 1
  if (count <= 3) return 2
  if (count <= 7) return 3
  return 4
}

export function cadenceGrid(days: readonly CadenceObservation[]): CadenceGrid {
  const columns: { cells: CadenceCell[]; monthLabel: string | undefined }[] = []
  for (let start = 0; start < days.length; start += 7) {
    columns.push({
      cells: days.slice(start, start + 7).map(({ date, count }) => ({ date, count, level: cadenceLevel(count) })),
      monthLabel: undefined,
    })
  }

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

/** Screen-reader label: `3 posts on 3 june 2026`. */
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

const WEEKDAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'] as const
