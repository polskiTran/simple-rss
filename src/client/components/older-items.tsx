import { Button } from '@base-ui/react/button'

export type OlderState = 'idle' | 'loading' | 'failed'

/**
 * The way further along a paged list — back in time, or forward when the list
 * runs oldest first; absent once the list has ended.
 */
export function OlderItems({
  nextCursor,
  older,
  noun,
  toward = 'older',
  onLoadOlder,
}: {
  nextCursor: string | null
  older: OlderState
  noun: 'items' | 'saves'
  toward?: 'older' | 'newer'
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
        {older === 'loading' ? `Loading ${toward} ${noun}…` : older === 'failed' ? 'Retry' : `Show ${toward} ${noun}`}
      </Button>
      {older === 'failed' ? (
        <p className="note note-error" role="status">
          {toward === 'older' ? 'Older' : 'Newer'} {noun} are out of reach.
        </p>
      ) : null}
    </div>
  )
}
