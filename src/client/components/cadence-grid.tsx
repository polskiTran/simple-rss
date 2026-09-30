import type { CSSProperties } from 'react'
import { cadenceDayLabel, type CadenceGrid as Grid } from '../cadence.js'

export interface CadenceGridProps {
  readonly grid: Grid
  readonly title: string
  /** The day on show, ringed. */
  readonly selected?: string | undefined
  /** A day with items is a button that brings its items into view. */
  onShowDay(date: string): void
}

/** 26 weeks as columns of seven days, oldest on the left, with months under them. */
export function CadenceGrid({ grid, title, selected, onShowDay }: CadenceGridProps) {
  return (
    <div className="cadence-figure">
      <div className="cadence-grid" role="group" aria-label={`26 weeks of Cadence for ${title}`}>
        {grid.columns.flatMap((column) =>
          column.cells.map((cell) =>
            cell.count > 0 ? (
              <button
                key={cell.date}
                type="button"
                className="cadence-cell"
                data-level={cell.level}
                data-selected={cell.date === selected ? '' : undefined}
                aria-pressed={selected === undefined ? undefined : cell.date === selected}
                aria-label={`${cadenceDayLabel(cell)}, show that day`}
                title={cadenceDayLabel(cell)}
                onClick={() => onShowDay(cell.date)}
              />
            ) : (
              <span
                key={cell.date}
                className="cadence-cell"
                data-level={0}
                data-selected={cell.date === selected ? '' : undefined}
                aria-hidden="true"
              />
            ),
          ),
        )}
      </div>
      <div className="cadence-months" aria-hidden="true">
        {grid.columns.map((column, index) => {
          if (!column.monthLabel) return null
          // SAFETY: React forwards CSS custom properties even though `CSSProperties`
          // only declares standard CSS names.
          const style = { '--column': index } as CSSProperties
          return (
            <span key={column.cells[0]?.date ?? index} className="cadence-month" style={style}>
              {column.monthLabel}
            </span>
          )
        })}
      </div>
      <CadenceLegend />
    </div>
  )
}

/** The five shades a count is drawn in, least to most. */
export function CadenceLegend() {
  return (
    <p className="cadence-legend" aria-hidden="true">
      Fewer
      {([0, 1, 2, 3, 4] as const).map((level) => (
        <span key={level} className="cadence-cell" data-level={level} />
      ))}
      More items
    </p>
  )
}
