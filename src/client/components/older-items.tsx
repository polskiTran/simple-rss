import { Button } from '@base-ui/react/button'
import type { OlderState } from '../use-resource.js'

export function OlderItems<Cursor extends string>({
  nextCursor,
  older,
  noun,
  onLoadOlder,
}: {
  nextCursor: Cursor | null
  older: OlderState
  noun: 'items' | 'saves'
  onLoadOlder: (cursor: Cursor) => void
}) {
  if (nextCursor === null) return null
  return (
    <div className="more">
      <Button
        className="button"
        focusableWhenDisabled
        disabled={older === 'loading'}
        aria-busy={older === 'loading'}
        onClick={() => onLoadOlder(nextCursor)}
      >
        {older === 'loading' ? `Loading more ${noun}…` : older === 'failed' ? 'Retry' : 'Show more'}
      </Button>
      {older === 'failed' ? (
        <p className="note note-error" role="status">
          More {noun} are out of reach.
        </p>
      ) : null}
    </div>
  )
}
