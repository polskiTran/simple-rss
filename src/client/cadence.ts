import type { CadenceObservation, DateKey } from '../shared/api.js'
import { counted, fullDate } from './day-names.js'

interface CadenceCell {
  readonly date: DateKey
  readonly count: number
  readonly level: 0 | 1 | 2 | 3 | 4
}

interface CadenceColumn {
  readonly cells: readonly CadenceCell[]
}

export interface CadenceGrid {
  readonly columns: readonly CadenceColumn[]
}

export function cadenceLevel(count: number): 0 | 1 | 2 | 3 | 4 {
  if (count === 0) return 0
  if (count === 1) return 1
  if (count <= 3) return 2
  if (count <= 7) return 3
  return 4
}

export function cadenceGrid(days: readonly CadenceObservation[]): CadenceGrid {
  const columns: CadenceColumn[] = []
  for (let start = 0; start < days.length; start += 7) {
    columns.push({
      cells: days.slice(start, start + 7).map(({ date, count }) => ({ date, count, level: cadenceLevel(count) })),
    })
  }
  return { columns }
}

export function cadenceDayLabel(cell: CadenceCell): string {
  return `${counted(cell.count, 'Feed Item')} on ${fullDate(cell.date)}`
}
