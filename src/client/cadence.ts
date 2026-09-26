import type { CadenceObservation } from '../shared/api.js'

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

/** What a Feed's Info panel says about its 26 weeks. */
export interface CadenceStats {
  readonly total: number
  /** Undefined when nothing was published. */
  readonly busiestWeekday: string | undefined
  /** The longest run of days without a Feed Item, 0 when there was none. */
  readonly longestQuiet: number
}

export interface CadenceGrid {
  readonly columns: readonly CadenceColumn[]
  readonly stats: CadenceStats
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

  // A label where a column opens a month, never within six columns of the last.
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

/** Screen-reader label: `3 items on 3 June 2026`. */
export function cadenceDayLabel(cell: CadenceCell): string {
  const [year, month, day] = cell.date.split('-')
  const monthName = MONTH_NAMES[Number(month) - 1] ?? ''
  return `${counted(cell.count, 'item')} on ${Number(day)} ${monthName} ${year}`
}

function statsOf(days: readonly CadenceObservation[]): CadenceStats {
  const total = days.reduce((sum, { count }) => sum + count, 0)

  const byWeekday = Array.from({ length: 7 }, () => 0)
  for (const { date, count } of days) {
    // Monday first, so a tie goes to the earlier day of the week.
    const weekday = (new Date(`${date}T12:00:00Z`).getUTCDay() + 6) % 7
    byWeekday[weekday] = (byWeekday[weekday] ?? 0) + count
  }
  const busiest = byWeekday.indexOf(Math.max(...byWeekday))

  let quiet = 0
  let longestQuiet = 0
  for (const { count } of days) {
    quiet = count === 0 ? quiet + 1 : 0
    longestQuiet = Math.max(longestQuiet, quiet)
  }

  return { total, busiestWeekday: total === 0 ? undefined : WEEKDAYS[busiest], longestQuiet }
}

function monthOf(date: string | undefined): number | undefined {
  if (!date) return undefined
  return Number(date.slice(5, 7)) - 1
}

export function counted(count: number, noun: string): string {
  return count === 1 ? `1 ${noun}` : `${count.toLocaleString('en-GB')} ${noun}s`
}

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const

const MONTHS = MONTH_NAMES.map((name) => name.slice(0, 3))

const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'] as const
