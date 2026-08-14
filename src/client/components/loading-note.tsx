import { MarkTile } from './wordmark.js'

export interface LoadingNoteProps {
  readonly className?: string | undefined
  readonly announce?: boolean | undefined
  readonly children: string
}

export function LoadingNote({ className, announce, children }: LoadingNoteProps) {
  return (
    <p
      className={className === undefined ? 'loading-note' : `${className} loading-note`}
      {...(announce ? { role: 'status' } : {})}
    >
      <MarkTile />
      {children}
    </p>
  )
}
