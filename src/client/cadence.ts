import type { CadenceObservation } from '../shared/api.js'
import { counted, fullDate, shortMonth, weekday } from './day-names.js'

interface CadenceCell {
  readonly date: string
  readonly count: number
  readonly level: 0 | 1 | 2 | 3 | 4
}

/** One week of the grid. The last column ends on today and may be short. */
interface CadenceColumn {
  readonly cells: readonly CadenceCell[]
  readonly monthLabel: string | undefined
}

/** What a Feed's Info panel says about its 26 weeks. */
interface CadenceStats {
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

/**
 * Levels for counts too large for one Feed's thresholds — the whole Digest's
 * days — split at the quartiles of `counts`' days with any items.
 */
export function relativeLevels(counts: readonly number[]): (count: number) => 0 | 1 | 2 | 3 | 4 {
  const busy = counts.filter((count) => count > 0).toSorted((left, right) => left - right)
  const quartile = (fraction: number) => busy[Math.floor((busy.length - 1) * fraction)] ?? 0
  const [first, second, third] = [quartile(0.25), quartile(0.5), quartile(0.75)]
  return (count) => (count === 0 ? 0 : count <= first ? 1 : count <= second ? 2 : count <= third ? 3 : 4)
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
    const opening = column.cells[0]?.date
    if (opening === undefined) continue
    const previous = columns[index - 1]?.cells[0]?.date
    const sameMonth = previous !== undefined && previous.slice(0, 7) === opening.slice(0, 7)
    if (index > 0 && (sameMonth || (lastLabelled !== undefined && index - lastLabelled < 6))) continue
    column.monthLabel = shortMonth(opening)
    lastLabelled = index
  }

  return { columns, stats: statsOf(days) }
}

/** Screen-reader label: `3 items on 3 June 2026`. */
export function cadenceDayLabel(cell: CadenceCell): string {
  return `${counted(cell.count, 'item')} on ${fullDate(cell.date)}`
}

function statsOf(days: readonly CadenceObservation[]): CadenceStats {
  const total = days.reduce((sum, { count }) => sum + count, 0)

  const byWeekday = Array.from({ length: 7 }, () => 0)
  for (const { date, count } of days) {
    // Monday first, so a tie goes to the earlier day of the week.
    const day = mondayFirst(date)
    byWeekday[day] = (byWeekday[day] ?? 0) + count
  }
  const busiest = byWeekday.indexOf(Math.max(...byWeekday))
  // Any day of the busiest weekday names it.
  const busiestDay = days.find(({ date }) => mondayFirst(date) === busiest)

  let quiet = 0
  let longestQuiet = 0
  for (const { count } of days) {
    quiet = count === 0 ? quiet + 1 : 0
    longestQuiet = Math.max(longestQuiet, quiet)
  }

  return { total, busiestWeekday: total === 0 || !busiestDay ? undefined : weekday(busiestDay.date), longestQuiet }
}

/** The day of the week, Monday 0 to Sunday 6. */
function mondayFirst(date: string): number {
  return (new Date(`${date}T12:00:00Z`).getUTCDay() + 6) % 7
}
