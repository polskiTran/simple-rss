import { useCallback, useEffect, useState } from 'react'

/**
 * The four places the Owner can be. They are fixed and always in this order —
 * `docs/DESIGN.md` treats the tab bar as furniture that never moves, so the
 * route list and the navigation are the same list.
 */
export const ROUTES = ['digest', 'feeds', 'saved', 'settings'] as const
export type Route = (typeof ROUTES)[number]

export const DEFAULT_ROUTE: Route = 'digest'

export function pathOf(route: Route): string {
  return `/${route}`
}

/**
 * Reads a route out of a URL path. Anything unrecognised — including `/` —
 * lands on the Digest, so a stale link opens the reader rather than an error.
 */
export function routeOf(pathname: string): Route {
  const first = pathname.split('/').filter(Boolean)[0]
  return ROUTES.find((route) => route === first) ?? DEFAULT_ROUTE
}

export interface Navigation {
  readonly route: Route
  navigate(route: Route): void
}

/**
 * A history-backed router in place of a routing library. Four sibling views
 * with no nesting, params, or loaders do not justify the dependency.
 */
export function useNavigation(): Navigation {
  const [route, setRoute] = useState<Route>(() => routeOf(window.location.pathname))

  useEffect(() => {
    const onPopState = () => setRoute(routeOf(window.location.pathname))
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

  const navigate = useCallback((next: Route) => {
    if (routeOf(window.location.pathname) !== next) {
      window.history.pushState(null, '', pathOf(next))
    }
    setRoute(next)
  }, [])

  return { route, navigate }
}
