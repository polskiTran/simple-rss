import type { CSSProperties } from 'react'
import { routedClick } from '../routed-link.js'
import { pathOf } from '../routing.js'

/**
 * A 4x4 tile of 3px squares in the five ink levels of the cadence ramp,
 * followed by the name in italic — `docs/references/brand.png`. The mark says
 * what the product is by borrowing the one figure it already draws: a matrix
 * of ink levels standing for volume over time.
 *
 * Levels are the cadence grid's own, 0 (quietest) to 4 (ink), so the mark
 * cannot drift from the ramp it quotes.
 */
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
          // The glint crosses the tile along the anti-diagonal, so `row + col`
          // is the order a cell takes its turn — the sweep runs against the
          // leading diagonal the peaks sit on, and the mark reads as lit
          // across rather than filled in. The wait spends the same order.
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

  // A real link, like the tabs: open-in-new-tab and copy-the-address keep
  // working. It carries no `aria-current` — the Digest tab is the one that
  // says where the User is.
  return (
    <a className="wordmark" href={pathOf('digest')} onClick={routedClick(onNavigate)}>
      {mark}
    </a>
  )
}
