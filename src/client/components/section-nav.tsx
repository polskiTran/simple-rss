import { routedClick } from '../routed-link.js'
import { pathOf, ROUTE_LABELS, type Route } from '../routing.js'
import { Icon, type IconName } from './icon.js'

export interface SectionNavProps {
  readonly active: Route
  readonly onNavigate: (route: Route) => void
}

/**
 * The four sections as links whose URLs are the routing state: Digest and
 * Feeds as a switch, Saved and Settings as buttons beside the search. A phone
 * keeps them in its one top row, the two buttons as icon squares.
 */
export function SectionNav({ active, onNavigate }: SectionNavProps) {
  const link = (route: Route, className: string, icon?: IconName) => (
    <a
      className={className}
      href={pathOf(route)}
      aria-current={route === active ? 'page' : undefined}
      onClick={routedClick(() => onNavigate(route))}
    >
      {icon ? (
        <>
          <Icon name={icon} />
          <span className="section-button-label">{ROUTE_LABELS[route]}</span>
        </>
      ) : (
        ROUTE_LABELS[route]
      )}
    </a>
  )

  return (
    <nav className="sections" aria-label="Sections">
      <span className="switch sections-switch">
        {link('digest', 'switch-segment')}
        {link('feeds', 'switch-segment')}
      </span>
      {link('saved', 'button section-button saved-link', 'library')}
      {link('settings', 'button section-button settings-link', 'settings')}
    </nav>
  )
}
