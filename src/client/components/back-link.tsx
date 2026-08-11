import { routedClick } from '../routed-link.js'
import type { Origin } from '../routing.js'

export interface BackLinkProps {
  readonly origin: Origin
  readonly className: string
  /** Follows the way back when the shell handles the click. */
  onBack(origin: Origin): void
}

/**
 * The way out of a nested screen, named after the screen it returns to. A real
 * link, so open-in-new-tab and copy-the-address keep working, routed by the
 * shell for a plain click.
 */
export function BackLink({ origin, className, onBack }: BackLinkProps) {
  return (
    <a className={className} href={origin.path} onClick={routedClick(() => onBack(origin))}>
      ← {origin.label}
    </a>
  )
}
