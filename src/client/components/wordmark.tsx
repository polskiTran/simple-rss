import type { CSSProperties } from 'react'
import { routedClick } from '../routed-link.js'
import { pathOf } from '../routing.js'

// 4x4 tile in the cadence grid's own ink levels, 0 (quietest) to 4 (ink), so
// the mark cannot drift from the ramp it quotes — `docs/references/brand.png`.
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
        row.map((level, x) => (
          // `row + col` steps cells along the anti-diagonal — the order both
          // the glint and the loading wait sweep, against the diagonal the
          // peaks sit on.
          <span
            key={`${y}-${x}`}
            className="wordmark-cell"
            data-level={level}
            style={{ '--glint-step': y + x } as CSSProperties}
          />
        )),
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

  // A real link, like the tabs. No `aria-current`: the Digest tab is what
  // says where the User is.
  return (
    <a className="wordmark" href={pathOf('digest')} onClick={routedClick(onNavigate)}>
      {mark}
    </a>
  )
}
