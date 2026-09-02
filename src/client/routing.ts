import { z } from 'zod'
import { useCallback, useEffect, useState } from 'react'
import { searchParamsOf, searchRequestSchema, type SearchScope } from '../shared/api.js'

export const ROUTES = ['digest', 'feeds', 'saved', 'settings'] as const
export type Route = (typeof ROUTES)[number]

export const DEFAULT_ROUTE: Route = 'digest'

export function pathOf(route: Route): string {
  return `/${route}`
}

export function routeOf(pathname: string): Route {
  const first = pathname.split('/').filter(Boolean)[0]
  return ROUTES.find((route) => route === first) ?? DEFAULT_ROUTE
}

export function feedPathOf(feedId: number): string {
  return `/feeds/${feedId}`
}

export function feedIdOf(pathname: string): number | undefined {
  return nestedIdOf(pathname, 'feeds')
}

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

/** The search address is the API request: `/search?` followed by the same parameters. */
export function searchPathOf(query: string, scope: SearchScope): string {
  return `/search?${searchParamsOf(query, scope)}`
}

function searchOf(pathname: string, search: string): { query: string; scope: SearchScope } | undefined {
  if (pathname !== '/search') return undefined
  const parsed = searchRequestSchema.safeParse(Object.fromEntries(new URLSearchParams(search)))
  return parsed.success && parsed.data.query.trim() !== '' ? parsed.data : undefined
}

/** The tab a search reads under: its scope's own section, or the Digest everywhere. */
const SECTION_OF_SCOPE = {
  everywhere: 'digest',
  saved: 'saved',
  subscriptions: 'feeds',
  feed: 'feeds',
} as const satisfies Record<SearchScope['kind'], Route>

/**
 * The way back out of a nested screen, recursively. Kept in history state, so
 * it survives back, forward and reload.
 */
export interface Origin {
  readonly path: string
  readonly label: string
  readonly from: Origin | undefined
}

export const DIGEST_ORIGIN: Origin = { path: pathOf('digest'), label: 'digest', from: undefined }
export const FEEDS_ORIGIN: Origin = { path: pathOf('feeds'), label: 'feeds', from: undefined }
export const SAVED_ORIGIN: Origin = { path: pathOf('saved'), label: 'saved', from: undefined }

export function feedOrigin(feedId: number, title: string, from: Origin | undefined): Origin {
  return { path: feedPathOf(feedId), label: title, from }
}

export function readerOrigin(feedItemId: number, from: Origin | undefined): Origin {
  return { path: readerPathOf(feedItemId), label: 'article', from }
}

export function searchOrigin(query: string, scope: SearchScope, from: Origin | undefined): Origin {
  return { path: searchPathOf(query, scope), label: 'search', from }
}

/** One derivation of the scope, from the screen's address alone. */
function searchScopeOfScreen(pathname: string): SearchScope {
  const feedId = feedIdOf(pathname)
  if (feedId !== undefined) return { kind: 'feed', feedId }
  if (pathname === pathOf('saved')) return { kind: 'saved' }
  if (pathname === pathOf('feeds')) return { kind: 'subscriptions' }
  return { kind: 'everywhere' }
}

const MAX_TRAIL = 6

const historyPathSchema = z.string().regex(/^\/[a-z]+(\/[1-9]\d*)?$|^\/search\?[^#]*$/)

const historyOriginSchema = z.object({
  path: historyPathSchema,
  label: z.string().min(1),
  from: z.unknown().optional(),
})

const historyStateSchema = z.object({
  origin: z.unknown().optional(),
})

function trailOf(value: unknown, depth = 0): Origin | undefined {
  if (depth >= MAX_TRAIL) return undefined
  const parsed = historyOriginSchema.safeParse(value)
  if (!parsed.success) return undefined
  return {
    path: parsed.data.path,
    label: parsed.data.label,
    from: trailOf(parsed.data.from, depth + 1),
  }
}

interface ScreenLocation {
  readonly kind: 'screen'
  readonly route: Route
  readonly feedId: number | undefined
  readonly readerItemId: number | undefined
  /** Set while a nested screen is open. */
  readonly origin: Origin | undefined
  readonly searchScope: SearchScope
}

interface SearchLocation {
  readonly kind: 'search'
  readonly route: Route
  readonly query: string
  /** The screen the search left; clearing the line lands there. */
  readonly origin: Origin | undefined
  readonly searchScope: SearchScope
}

interface NavigationActions {
  navigate(route: Route): void
  openFeed(feedId: number, from: Origin): void
  openReader(feedItemId: number, from: Origin): void
  returnTo(origin: Origin): void
  updateSearch(query: string): void
  /** Re-asks the same words everywhere; the origin stays, so clearing still lands there. */
  searchEverywhere(): void
}

export type Navigation = (ScreenLocation | SearchLocation) & NavigationActions

export type ScreenNavigation = Extract<Navigation, { readonly kind: 'screen' }>

type Location = ScreenLocation | SearchLocation

export function useNavigation(): Navigation {
  const [location, setLocation] = useState<Location>(() => currentLocation())

  useEffect(() => {
    const onPopState = () => setLocation(currentLocation())
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

  const place = useCallback((path: string, from: Origin | undefined, how: 'push' | 'replace') => {
    const origin = trailOf(from)
    window.history[`${how}State`](origin ? { origin } : null, '', path)
    setLocation(locationOf(path, origin))
  }, [])

  const go = useCallback(
    (path: string, from: Origin | undefined) =>
      place(path, from, window.location.pathname + window.location.search === path ? 'replace' : 'push'),
    [place],
  )

  const navigate = useCallback((next: Route) => go(pathOf(next), undefined), [go])
  const openFeed = useCallback((feedId: number, from: Origin) => go(feedPathOf(feedId), from), [go])
  const openReader = useCallback((feedItemId: number, from: Origin) => go(readerPathOf(feedItemId), from), [go])
  const returnTo = useCallback((origin: Origin) => go(origin.path, origin.from), [go])

  const updateSearch = useCallback(
    (query: string) => {
      if (query.trim() === '') {
        if (location.kind !== 'search') return
        go(location.origin?.path ?? pathOf(DEFAULT_ROUTE), location.origin?.from)
        return
      }

      // Refining a search rewrites its entry rather than stacking one per pause.
      if (location.kind === 'search') {
        place(searchPathOf(query, location.searchScope), location.origin, 'replace')
        return
      }

      go(searchPathOf(query, location.searchScope), searchScreenOrigin(location))
    },
    [location, go, place],
  )

  const searchEverywhere = useCallback(() => {
    if (location.kind !== 'search') return
    place(searchPathOf(location.query, { kind: 'everywhere' }), location.origin, 'replace')
  }, [location, place])

  return { ...location, navigate, openFeed, openReader, returnTo, updateSearch, searchEverywhere }
}

function currentLocation(): Location {
  const state = historyStateSchema.safeParse(window.history.state)
  const origin = trailOf(state.success ? state.data.origin : undefined)
  return locationOf(window.location.pathname + window.location.search, origin)
}

function locationOf(path: string, origin: Origin | undefined): Location {
  const cut = path.indexOf('?')
  const pathname = cut === -1 ? path : path.slice(0, cut)
  const search = cut === -1 ? '' : path.slice(cut)
  const found = searchOf(pathname, search)
  if (found === undefined) return screenLocationOf(pathname, origin)
  return {
    kind: 'search',
    route: SECTION_OF_SCOPE[found.scope.kind],
    query: found.query,
    origin,
    searchScope: found.scope,
  }
}

/** The results surface shows no way-back link, so a search's origin label is never read. */
function searchScreenOrigin(location: ScreenLocation): Origin {
  if (location.readerItemId !== undefined) return readerOrigin(location.readerItemId, location.origin)
  if (location.feedId !== undefined) return { path: feedPathOf(location.feedId), label: 'feed', from: location.origin }
  return { path: pathOf(location.route), label: location.route, from: undefined }
}

function screenLocationOf(pathname: string, origin: Origin | undefined): ScreenLocation {
  const readerItemId = readerItemIdOf(pathname)
  const route = readerItemId !== undefined && origin ? routeOf(origin.path) : routeOf(pathname)
  return {
    kind: 'screen',
    route,
    feedId: feedIdOf(pathname),
    readerItemId,
    origin,
    searchScope: searchScopeOfScreen(pathname),
  }
}
