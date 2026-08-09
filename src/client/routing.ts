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

/** The one nested place: `/feeds/7` is the Feeds tab with one Feed open. */
export function feedPathOf(feedId: number): string {
  return `/feeds/${feedId}`
}

export function feedIdOf(pathname: string): number | undefined {
  const [first, second] = pathname.split('/').filter(Boolean)
  if (first !== 'feeds' || !second || !/^[1-9]\d*$/.test(second)) return undefined
  const feedId = Number(second)
  return Number.isSafeInteger(feedId) ? feedId : undefined
}

export interface Navigation {
  readonly route: Route
  /** Set while one Feed is open inside the Feeds tab. */
  readonly feedId: number | undefined
  navigate(route: Route): void
  openFeed(feedId: number): void
}

interface Location {
  readonly route: Route
  readonly feedId: number | undefined
}

/**
 * A history-backed router in place of a routing library. Four sibling views
 * with one nested Feed do not justify the dependency.
 */
export function useNavigation(): Navigation {
  const [location, setLocation] = useState<Location>(() => locationOf(window.location.pathname))

  useEffect(() => {
    const onPopState = () => setLocation(locationOf(window.location.pathname))
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

  const navigate = useCallback((next: Route) => {
    if (window.location.pathname !== pathOf(next)) {
      window.history.pushState(null, '', pathOf(next))
    }
    setLocation({ route: next, feedId: undefined })
  }, [])

  const openFeed = useCallback((feedId: number) => {
    if (window.location.pathname !== feedPathOf(feedId)) {
      window.history.pushState(null, '', feedPathOf(feedId))
    }
    setLocation({ route: 'feeds', feedId })
  }, [])

  return { ...location, navigate, openFeed }
}

function locationOf(pathname: string): Location {
  const route = routeOf(pathname)
  return { route, feedId: route === 'feeds' ? feedIdOf(pathname) : undefined }
}
