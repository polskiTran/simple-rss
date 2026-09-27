import { z } from 'zod'
import { useCallback, useEffect, useState } from 'react'
import { dateKeySchema, searchParamsOf, searchRequestSchema, type SearchScope, type SearchSort } from '../shared/api.js'
import { RHYTHMS, type Rhythm } from '../shared/rhythm.js'

export const ROUTES = ['digest', 'feeds', 'saved', 'settings'] as const
export type Route = (typeof ROUTES)[number]

export const DEFAULT_ROUTE: Route = 'digest'

export const ROUTE_LABELS = {
  digest: 'Digest',
  feeds: 'Feeds',
  saved: 'Saved',
  settings: 'Settings',
} as const satisfies Record<Route, string>

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

/**
 * The Digest's three ways of reading. The address carries it, so the way back
 * from the Reader returns to the same one. By day without a day is today.
 */
export type DigestMode =
  | { readonly by: 'all'; readonly rhythm: Rhythm | undefined }
  | { readonly by: 'day'; readonly day: string | undefined }
  | { readonly by: 'feed' }

export const ALL_POSTS: DigestMode = { by: 'all', rhythm: undefined }

export function digestPathOf(mode: DigestMode): string {
  const params = new URLSearchParams()
  if (mode.by === 'all' && mode.rhythm) params.set('rhythm', mode.rhythm)
  if (mode.by !== 'all') params.set('by', mode.by)
  if (mode.by === 'day' && mode.day) params.set('day', mode.day)
  return params.size > 0 ? `/digest?${params}` : '/digest'
}

/** Anything unreadable falls back to its mode's default rather than failing the screen. */
function digestModeOf(search: string): DigestMode {
  const params = new URLSearchParams(search)
  const by = params.get('by')
  if (by === 'feed') return { by: 'feed' }
  if (by === 'day') {
    const day = dateKeySchema.safeParse(params.get('day'))
    return { by: 'day', day: day.success ? day.data : undefined }
  }
  const rhythm = z.enum(RHYTHMS).safeParse(params.get('rhythm'))
  return { by: 'all', rhythm: rhythm.success ? rhythm.data : undefined }
}

/** The search address is the API request: `/search?` followed by the same parameters. */
export function searchPathOf(query: string, scope: SearchScope, sort: SearchSort = 'best'): string {
  return `/search?${searchParamsOf(query, scope, sort)}`
}

function searchOf(
  pathname: string,
  search: string,
): { query: string; scope: SearchScope; sort: SearchSort } | undefined {
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

export const DIGEST_ORIGIN: Origin = { path: pathOf('digest'), label: ROUTE_LABELS.digest, from: undefined }

export function digestOrigin(mode: DigestMode): Origin {
  return { ...DIGEST_ORIGIN, path: digestPathOf(mode) }
}
export const FEEDS_ORIGIN: Origin = { path: pathOf('feeds'), label: ROUTE_LABELS.feeds, from: undefined }
export const SAVED_ORIGIN: Origin = { path: pathOf('saved'), label: ROUTE_LABELS.saved, from: undefined }

export function feedOrigin(feedId: number, title: string, from: Origin | undefined): Origin {
  return { path: feedPathOf(feedId), label: title, from }
}

export function readerOrigin(feedItemId: number, from: Origin | undefined): Origin {
  return { path: readerPathOf(feedItemId), label: 'Article', from }
}

export function searchOrigin(query: string, scope: SearchScope, sort: SearchSort, from: Origin | undefined): Origin {
  return { path: searchPathOf(query, scope, sort), label: 'Search', from }
}

/** One derivation of the scope, from the screen's address alone. */
export function searchScopeOfScreen(pathname: string): SearchScope {
  const feedId = feedIdOf(pathname)
  if (feedId !== undefined) return { kind: 'feed', feedId }
  if (pathname === pathOf('saved')) return { kind: 'saved' }
  if (pathname === pathOf('feeds')) return { kind: 'subscriptions' }
  return { kind: 'everywhere' }
}

const MAX_TRAIL = 6

const historyPathSchema = z.string().regex(/^\/[a-z]+(\/[1-9]\d*)?$|^\/(search|digest)\?[^#]*$/)

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
  /** Read from the address on the Digest; All posts anywhere else. */
  readonly digest: DigestMode
}

interface SearchLocation {
  readonly kind: 'search'
  readonly route: Route
  readonly query: string
  /** The screen the search left; clearing the line lands there. */
  readonly origin: Origin | undefined
  readonly searchScope: SearchScope
  readonly searchSort: SearchSort
}

interface NavigationActions {
  navigate(route: Route): void
  openFeed(feedId: number, from: Origin): void
  openReader(feedItemId: number, from: Origin): void
  returnTo(origin: Origin): void
  updateSearch(query: string): void
  /** Re-asks the same words in another scope; the origin stays, so clearing still lands there. */
  searchIn(scope: SearchScope): void
  /** Re-asks the same words ranked another way, in place like `searchIn`. */
  sortSearch(sort: SearchSort): void
  /** Reads the Digest another way, in place: a switch or a day step is not a trail to walk back. */
  showDigest(mode: DigestMode): void
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
        place(searchPathOf(query, location.searchScope, location.searchSort), location.origin, 'replace')
        return
      }

      go(searchPathOf(query, location.searchScope), searchScreenOrigin(location))
    },
    [location, go, place],
  )

  const searchIn = useCallback(
    (scope: SearchScope) => {
      if (location.kind !== 'search') return
      place(searchPathOf(location.query, scope, location.searchSort), location.origin, 'replace')
    },
    [location, place],
  )

  const sortSearch = useCallback(
    (sort: SearchSort) => {
      if (location.kind !== 'search') return
      place(searchPathOf(location.query, location.searchScope, sort), location.origin, 'replace')
    },
    [location, place],
  )

  const showDigest = useCallback((mode: DigestMode) => place(digestPathOf(mode), undefined, 'replace'), [place])

  return { ...location, navigate, openFeed, openReader, returnTo, updateSearch, searchIn, sortSearch, showDigest }
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
  if (found === undefined) return screenLocationOf(pathname, search, origin)
  return {
    kind: 'search',
    route: SECTION_OF_SCOPE[found.scope.kind],
    query: found.query,
    origin,
    searchScope: found.scope,
    searchSort: found.sort,
  }
}

/** The results surface shows no way-back link, so a search's origin label is never read. */
function searchScreenOrigin(location: ScreenLocation): Origin {
  if (location.readerItemId !== undefined) return readerOrigin(location.readerItemId, location.origin)
  if (location.feedId !== undefined) return { path: feedPathOf(location.feedId), label: 'Feed', from: location.origin }
  return { path: pathOf(location.route), label: ROUTE_LABELS[location.route], from: undefined }
}

function screenLocationOf(pathname: string, search: string, origin: Origin | undefined): ScreenLocation {
  const readerItemId = readerItemIdOf(pathname)
  const route = readerItemId !== undefined && origin ? routeOf(origin.path) : routeOf(pathname)
  return {
    kind: 'screen',
    route,
    feedId: feedIdOf(pathname),
    readerItemId,
    origin,
    searchScope: searchScopeOfScreen(pathname),
    digest: pathname === pathOf('digest') ? digestModeOf(search) : ALL_POSTS,
  }
}
