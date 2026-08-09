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
  return nestedIdOf(pathname, 'feeds')
}

/**
 * The Reader: `/reader/42` is one Feed Item opened for reading. It lives
 * outside the four tabs, the way an opened article sits over the reading
 * flow rather than inside its furniture; the Digest stays the active tab.
 */
export function readerPathOf(feedItemId: number): string {
  return `/reader/${feedItemId}`
}

export function readerItemIdOf(pathname: string): number | undefined {
  return nestedIdOf(pathname, 'reader')
}

function nestedIdOf(pathname: string, section: string): number | undefined {
  const [first, second] = pathname.split('/').filter(Boolean)
  if (first !== section || !second || !/^[1-9]\d*$/.test(second)) return undefined
  const id = Number(second)
  return Number.isSafeInteger(id) ? id : undefined
}

export interface Navigation {
  readonly route: Route
  /** Set while one Feed is open inside the Feeds tab. */
  readonly feedId: number | undefined
  /** Set while one Feed Item is open in the Reader. */
  readonly readerItemId: number | undefined
  navigate(route: Route): void
  openFeed(feedId: number): void
  openReader(feedItemId: number): void
}

interface Location {
  readonly route: Route
  readonly feedId: number | undefined
  readonly readerItemId: number | undefined
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
    setLocation({ route: next, feedId: undefined, readerItemId: undefined })
  }, [])

  const openFeed = useCallback((feedId: number) => {
    if (window.location.pathname !== feedPathOf(feedId)) {
      window.history.pushState(null, '', feedPathOf(feedId))
    }
    setLocation({ route: 'feeds', feedId, readerItemId: undefined })
  }, [])

  const openReader = useCallback((feedItemId: number) => {
    if (window.location.pathname !== readerPathOf(feedItemId)) {
      window.history.pushState(null, '', readerPathOf(feedItemId))
    }
    setLocation({ route: 'digest', feedId: undefined, readerItemId: feedItemId })
  }, [])

  return { ...location, navigate, openFeed, openReader }
}

function locationOf(pathname: string): Location {
  const route = routeOf(pathname)
  return {
    route,
    feedId: route === 'feeds' ? feedIdOf(pathname) : undefined,
    readerItemId: readerItemIdOf(pathname),
  }
}
