import { routedClick } from '../routed-link.js'
import { pathOf, ROUTE_LABELS, type Route } from '../routing.js'

export interface SectionNavProps {
  readonly active: Route
  readonly onNavigate: (route: Route) => void
}

/**
 * The four sections as links whose URLs are the routing state. Desktop draws
 * the first three as the header switch and Settings as a button beside the
 * search; a phone draws all four as the bottom tab bar.
 */
export function SectionNav({ active, onNavigate }: SectionNavProps) {
  const link = (route: Route, className: string) => (
    <a
      className={className}
      href={pathOf(route)}
      aria-current={route === active ? 'page' : undefined}
      onClick={routedClick(() => onNavigate(route))}
    >
      {ROUTE_LABELS[route]}
    </a>
  )

  return (
    <nav className="sections" aria-label="Sections">
      <span className="switch sections-switch">
        {link('digest', 'switch-segment')}
        {link('feeds', 'switch-segment')}
        {link('saved', 'switch-segment')}
      </span>
      {link('settings', 'switch-segment settings-link')}
    </nav>
  )
}
