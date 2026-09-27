import { Button } from '@base-ui/react/button'

export interface LoadFailureProps {
  /** What failed to load, as a sentence opens: `The digest`, `Your saves` — the verbs agree with either. */
  readonly subject: string
  readonly kind: 'unreachable' | 'unavailable'
  onRetry(): void
}

/** A read that failed, told apart by cause: a silent network, or a server that answered wrong. */
export function LoadFailure({ subject, kind, onRetry }: LoadFailureProps) {
  return (
    <div className="load-failure">
      <p className="note note-error" role="status">
        {kind === 'unreachable'
          ? `${subject} can’t be reached. Check the connection, then try again.`
          : `${subject} didn’t load. Try again in a moment.`}
      </p>
      <Button className="button" onClick={onRetry}>
        Retry
      </Button>
    </div>
  )
}
