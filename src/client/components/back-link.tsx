import { routedClick } from '../routed-link.js'
import type { Origin } from '../routing.js'

export interface BackLinkProps {
  readonly origin: Origin
  readonly className: string
  onBack(origin: Origin): void
}

// A real link, so open-in-new-tab and copy-the-address keep working; a plain
// click is routed by the shell.
export function BackLink({ origin, className, onBack }: BackLinkProps) {
  return (
    <a className={className} href={origin.path} onClick={routedClick(() => onBack(origin))}>
      ← {origin.label}
    </a>
  )
}
