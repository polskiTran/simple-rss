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

export function Wordmark() {
  return (
    <span className="wordmark">
      <span className="wordmark-grid" aria-hidden="true">
        {TILE.flat().map((level, index) => (
          <span key={index} className="wordmark-cell" data-level={level} />
        ))}
      </span>
      <span className="wordmark-name">simple</span>
    </span>
  )
}
