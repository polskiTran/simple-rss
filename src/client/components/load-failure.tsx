import { Button } from '@base-ui/react/button'

export interface LoadFailureProps {
  /** What failed to load, as a sentence opens: `The digest`. */
  readonly subject: string
  readonly kind: 'unreachable' | 'unavailable'
  onRetry(): void
}

/** A read that failed, told apart by cause: a silent network, or a server that answered wrong. */
export function LoadFailure({ subject, kind, onRetry }: LoadFailureProps) {
  return (
    <div className="load-failure">
      <p className="note" role="status">
        {kind === 'unreachable'
          ? `${subject} is out of reach. Check the connection, then try again.`
          : `${subject} is unavailable. Try again in a moment.`}
      </p>
      <Button className="button" onClick={onRetry}>
        Retry
      </Button>
    </div>
  )
}
