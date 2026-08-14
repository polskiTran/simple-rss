import { Button } from '@base-ui/react/button'

export type OlderState = 'idle' | 'loading' | 'failed'

export function OlderItems({
  nextCursor,
  older,
  noun,
  onLoadOlder,
}: {
  nextCursor: string | null
  older: OlderState
  /** `items` or `saves`. */
  noun: string
  onLoadOlder: (cursor: string) => void
}) {
  if (nextCursor === null) return null
  return (
    <p className="older-items">
      {older === 'failed' ? <span role="status">older {noun} are out of reach — </span> : null}
      <Button
        className="text-button"
        focusableWhenDisabled
        disabled={older === 'loading'}
        onClick={() => onLoadOlder(nextCursor)}
      >
        {older === 'loading' ? `loading older ${noun}…` : older === 'failed' ? 'try again' : `older ${noun}`}
      </Button>
    </p>
  )
}
