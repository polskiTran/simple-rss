import { Button } from '@base-ui/react/button'
import type { OlderState } from '../use-resource.js'

/**
 * The way further along a paged list, in whichever order it runs; absent once
 * the list has ended. It says Show more rather than a number: a page may finish
 * the last day shown and run on into others, and nothing counts what remains.
 */
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
