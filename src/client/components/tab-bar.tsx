import { pathOf, ROUTES, type Route } from '../routing.js'

export interface TabBarProps {
  readonly active: Route
  readonly onNavigate: (route: Route) => void
}

/**
 * Four words, always in the same order, in the same place on every screen and
 * at every width. They are real links so the browser's own affordances — open
 * in a new tab, copy the address — keep working.
 */
export function TabBar({ active, onNavigate }: TabBarProps) {
  return (
    <nav className="tab-bar" aria-label="Sections">
      {ROUTES.map((route) => (
        <a
          key={route}
          className="tab"
          href={pathOf(route)}
          aria-current={route === active ? 'page' : undefined}
          onClick={(event) => {
            // Let the browser handle anything that is not a plain left click.
            if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) {
              return
            }
            event.preventDefault()
            onNavigate(route)
          }}
        >
          {route}
        </a>
      ))}
    </nav>
  )
}
