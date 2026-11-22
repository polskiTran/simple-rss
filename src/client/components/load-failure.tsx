import { Button } from '@base-ui/react/button'

interface LoadFailureProps {
  readonly subject: string
  readonly kind: 'unreachable' | 'unavailable'
  onRetry(): void
}

export function LoadFailure({ subject, kind, onRetry }: LoadFailureProps) {
  return (
    <div className="load-failure">
      <p className="note note-error" role="status">
        {kind === 'unreachable' ? `${subject} can’t be reached.` : `${subject} didn’t load.`}
      </p>
      <Button className="button" onClick={onRetry}>
        Retry
      </Button>
    </div>
  )
}
