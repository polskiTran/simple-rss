import type { CSSProperties } from 'react'
import { routedClick } from '../routed-link.js'
import { pathOf } from '../routing.js'

const TILE = [
  [4, 1, 3, 0],
  [2, 4, 0, 2],
  [3, 0, 4, 1],
  [0, 2, 1, 3],
] as const

export function MarkTile() {
  return (
    <span className="wordmark-grid" aria-hidden="true">
      {TILE.map((row, y) =>
        row.map((level, x) => {
          const antiDiagonal = y + x

          return (
            <span
              // biome-ignore lint/suspicious/noArrayIndexKey: TILE is a fixed decorative grid — the cell's position is its identity.
              key={`${y}-${x}`}
              className="wordmark-cell"
              data-level={level}
              style={{ '--glint-step': antiDiagonal } as CSSProperties}
            />
          )
        }),
      )}
    </span>
  )
}

export interface WordmarkProps {
  readonly onNavigate?: (() => void) | undefined
}

export function Wordmark({ onNavigate }: WordmarkProps) {
  const mark = (
    <>
      <MarkTile />
      <span className="wordmark-name">simple</span>
    </>
  )

  if (onNavigate === undefined) return <span className="wordmark">{mark}</span>

  return (
    <a className="wordmark" href={pathOf('digest')} onClick={routedClick(onNavigate)}>
      {mark}
    </a>
  )
}
