import { z } from 'zod'
import { useCallback, useEffect, useState } from 'react'
import { searchQuerySchema, type SearchScope } from '../shared/api.js'

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

export function searchPathOf(query: string): string {
  return `/search?${new URLSearchParams({ q: query })}`
}

function searchQueryOf(pathname: string, search: string): string | undefined {
  if (pathname !== '/search') return undefined
  const parsed = searchQuerySchema.safeParse(new URLSearchParams(search).get('q'))
  return parsed.success && parsed.data.trim() !== '' ? parsed.data : undefined
}

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

export function searchOrigin(query: string, from: Origin | undefined): Origin {
  return { path: searchPathOf(query), label: 'search', from }
}

/**
 * A search is bounded by the screen it was invoked from, read off that
 * screen's path: an opened Feed, the Library, or the Feeds list. Every other
 * screen — the Digest, the Reader, settings — searches everywhere.
 */
export function searchScopeOf(path: string): SearchScope {
  const feedId = feedIdOf(path)
  if (feedId !== undefined) return { kind: 'feed', feedId }
  if (path === pathOf('saved')) return { kind: 'saved' }
  if (path === pathOf('feeds')) return { kind: 'subscriptions' }
  return { kind: 'everywhere' }
}

const MAX_TRAIL = 6

const historyPathSchema = z.string().regex(/^\/[a-z]+(\/[1-9]\d*)?(\?q=[^#]*)?$/)

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
}

interface SearchLocation {
  readonly kind: 'search'
  /** A bounded search reads under its section's tab; one that answers everywhere reads under the Digest. */
  readonly route: Route
  readonly query: string
  readonly origin: Origin | undefined
}

interface NavigationActions {
  /** What the search line would answer from here: this screen's bound, or the open search's. */
  readonly searchScope: SearchScope
  navigate(route: Route): void
  openFeed(feedId: number, from: Origin): void
  openReader(feedItemId: number, from: Origin): void
  returnTo(origin: Origin): void
  updateSearch(query: string): void
  /** Re-asks the open search from the Digest, so it answers everywhere and clears back to the Digest. */
  widenSearch(): void
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

  const go = useCallback((path: string, from: Origin | undefined) => {
    const origin = trailOf(from)
    const state = origin ? { origin } : null
    if (window.location.pathname + window.location.search === path) {
      window.history.replaceState(state, '', path)
    } else {
      window.history.pushState(state, '', path)
    }
    setLocation(locationOf(path, origin))
  }, [])

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

      if (location.kind === 'search') {
        const state = location.origin ? { origin: location.origin } : null
        window.history.replaceState(state, '', searchPathOf(query))
        setLocation({ ...location, query })
        return
      }

      go(searchPathOf(query), searchScreenOrigin(location))
    },
    [location, go],
  )

  const widenSearch = useCallback(() => {
    if (location.kind !== 'search') return
    const path = searchPathOf(location.query)
    window.history.replaceState({ origin: DIGEST_ORIGIN }, '', path)
    setLocation(locationOf(path, DIGEST_ORIGIN))
  }, [location])

  const searchScope = searchScopeOf(
    location.kind === 'search' ? (location.origin?.path ?? pathOf(DEFAULT_ROUTE)) : searchScreenOrigin(location).path,
  )

  return { ...location, searchScope, navigate, openFeed, openReader, returnTo, updateSearch, widenSearch }
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
  const query = searchQueryOf(pathname, search)
  if (query !== undefined) return { kind: 'search', route: searchRouteOf(origin), query, origin }
  return screenLocationOf(pathname, origin)
}

function searchRouteOf(origin: Origin | undefined): Route {
  if (origin === undefined || searchScopeOf(origin.path).kind === 'everywhere') return DEFAULT_ROUTE
  return routeOf(origin.path)
}

function searchScreenOrigin(location: ScreenLocation): Origin {
  if (location.readerItemId !== undefined) return readerOrigin(location.readerItemId, location.origin)
  if (location.feedId !== undefined) return { path: feedPathOf(location.feedId), label: 'feed', from: location.origin }
  return { path: pathOf(location.route), label: location.route, from: undefined }
}

function screenLocationOf(pathname: string, origin: Origin | undefined): ScreenLocation {
  const readerItemId = readerItemIdOf(pathname)
  const route = readerItemId !== undefined && origin ? routeOf(origin.path) : routeOf(pathname)
  return { kind: 'screen', route, feedId: feedIdOf(pathname), readerItemId, origin }
}
