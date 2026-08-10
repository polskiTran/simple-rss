/** The one deliberate gesture that extends a list; nothing loads on scroll. */
export type OlderState = 'idle' | 'loading' | 'failed'

/**
 * A paged list's deliberate end: one quiet word that fetches the next page,
 * shown only while an older page exists. When the word is gone, the list is
 * simply over.
 */
export function OlderItems({
  nextCursor,
  older,
  noun,
  onLoadOlder,
}: {
  nextCursor: string | null
  older: OlderState
  /** What the control calls a page's worth: `items` or `saves`. */
  noun: string
  onLoadOlder: (cursor: string) => void
}) {
  if (nextCursor === null) return null
  return (
    <p className="older-items">
      {older === 'failed' ? <span role="status">older {noun} are out of reach — </span> : null}
      <button
        className="text-button"
        type="button"
        disabled={older === 'loading'}
        onClick={() => onLoadOlder(nextCursor)}
      >
        {older === 'loading' ? `loading older ${noun}…` : older === 'failed' ? 'try again' : `older ${noun}`}
      </button>
    </p>
  )
}
