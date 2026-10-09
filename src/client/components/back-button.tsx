import type { Origin } from '../routing.js'
import { Icon } from './icon.js'
import { RoutedLink } from './routed-link.js'

interface BackButtonProps {
  readonly origin: Origin
  /** The phone bar draws it as an icon square; a view draws it with its label. */
  readonly className?: string
  onBack(origin: Origin): void
}

/** The way out of a nested screen, named after the screen it returns to. */
export function BackButton({ origin, className, onBack }: BackButtonProps) {
  return (
    <RoutedLink
      className={className ? `button back-button ${className}` : 'button back-button'}
      href={origin.path}
      aria-label={`Back to ${origin.label}`}
      onNavigate={() => onBack(origin)}
    >
      <Icon name="arrow-left" />
      <span className="back-button-label">{origin.label}</span>
    </RoutedLink>
  )
}
