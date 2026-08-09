/**
 * A 3x3 grid of 3px squares, alternating ink and gap starting with ink — five
 * on, four off — followed by the name in italic.
 */
const CELLS = Array.from({ length: 9 }, (_, index) => index % 2 === 0)

export function Wordmark() {
  return (
    <span className="wordmark">
      <span className="wordmark-grid" aria-hidden="true">
        {CELLS.map((inked, index) => (
          <span key={index} className="wordmark-cell" data-ink={inked ? 'on' : 'off'} />
        ))}
      </span>
      <span className="wordmark-name">simple</span>
    </span>
  )
}
