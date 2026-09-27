import { Button } from '@base-ui/react/button'

export type OlderState = 'idle' | 'loading' | 'failed'

/** The way further back through a paged list; absent once the list has ended. */
export function OlderItems({
  nextCursor,
  older,
  noun,
  onLoadOlder,
}: {
  nextCursor: string | null
  older: OlderState
  noun: 'items' | 'saves'
  onLoadOlder: (cursor: string) => void
}) {
  if (nextCursor === null) return null
  return (
    <div className="more">
      <Button
        className="button"
        focusableWhenDisabled
        disabled={older === 'loading'}
        onClick={() => onLoadOlder(nextCursor)}
      >
        {older === 'loading' ? `Loading older ${noun}…` : older === 'failed' ? 'Retry' : `Show older ${noun}`}
      </Button>
      {older === 'failed' ? (
        <p className="note note-error" role="status">
          Older {noun} are out of reach.
        </p>
      ) : null}
    </div>
  )
}
