import { routedClick } from '../routed-link.js'
import { pathOf, ROUTES, type Route } from '../routing.js'

export interface TabBarProps {
  readonly active: Route
  readonly onNavigate: (route: Route) => void
}

// Same four links, same order, same place at every width. Real links, so
// open-in-new-tab and copy-the-address keep working.
export function TabBar({ active, onNavigate }: TabBarProps) {
  return (
    <nav className="tab-bar" aria-label="Sections">
      {ROUTES.map((route) => (
        <a
          key={route}
          className="tab"
          href={pathOf(route)}
          aria-current={route === active ? 'page' : undefined}
          onClick={routedClick(() => onNavigate(route))}
        >
          {route}
        </a>
      ))}
    </nav>
  )
}
