import { z } from 'zod'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  dateKeySchema,
  digestParamsOf,
  searchParamsOf,
  searchRequestSchema,
  type DigestFilter,
  type SearchScope,
  type SearchSort,
} from '../shared/api.js'

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
 * The Digest's two ways of reading. The address carries it, so the way back
 * from the Reader returns to the same one. By item is the Digest itself, newest
 * day first: its address is its API request, and without `from` it starts today.
 */
export type DigestMode = ({ readonly by: 'item' } & DigestFilter) | { readonly by: 'feed' }

export const DIGEST_TODAY: DigestMode = { by: 'item' }

export function digestPathOf(mode: DigestMode): string {
  const params = mode.by === 'item' ? digestParamsOf(mode) : new URLSearchParams({ by: mode.by })
  return params.size > 0 ? `/digest?${params}` : '/digest'
}

/** Anything unreadable falls back to its default rather than failing the screen. */
function digestModeOf(search: string): DigestMode {
  const params = new URLSearchParams(search)
  if (params.get('by') === 'feed') return { by: 'feed' }
  const from = dateKeySchema.safeParse(params.get('from'))
  return { by: 'item', from: from.success ? from.data : undefined }
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
  return { path: readerPathOf(feedItemId), label: 'Reader', from }
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

/**
 * What the app keeps on a history entry. `beneath` is the address of the entry
 * under this one, set when the app pushed it, so the way back can be the
 * browser's own Back. `scrollY` is where the page stood when the app left it.
 */
const historyStateSchema = z.object({
  origin: z.unknown().optional(),
  beneath: z.string().optional(),
  scrollY: z.number().optional(),
})

function historyState() {
  const parsed = historyStateSchema.safeParse(window.history.state)
  return parsed.success ? parsed.data : {}
}

function currentPath(): string {
  return window.location.pathname + window.location.search
}

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

/**
 * Set each time the User arrives at a history entry — a push, or the browser
 * or the way back going back — and kept by an in-place replace. `scrollY` is
 * where the page should stand: the top of a new screen, where a returned-to one
 * was left, or undefined when this app never recorded it. Undefined on first load.
 */
export interface Arrival {
  readonly scrollY: number | undefined
}

interface NavigationActions {
  readonly arrival: Arrival | undefined
  navigate(route: Route): void
  openFeed(feedId: number, from: Origin): void
  openReader(feedItemId: number, from: Origin): void
  /** Goes back to the entry beneath when it is the origin; otherwise walks to the origin's address. */
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
  const [arrival, setArrival] = useState<Arrival>()
  // Set between asking the browser to go back and its popstate, so a double
  // press cannot go back twice.
  const goingBack = useRef(false)

  useEffect(() => {
    const onPopState = () => {
      goingBack.current = false
      setLocation(currentLocation())
      setArrival({ scrollY: historyState().scrollY })
    }
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

  const place = useCallback((path: string, from: Origin | undefined, how: 'push' | 'replace') => {
    const origin = trailOf(from)
    const here = historyState()
    if (how === 'push') {
      window.history.replaceState({ ...here, scrollY: window.scrollY }, '')
      window.history.pushState({ origin, beneath: currentPath() }, '', path)
      setArrival({ scrollY: 0 })
    } else {
      window.history.replaceState({ origin, beneath: here.beneath }, '', path)
    }
    setLocation(locationOf(path, origin))
  }, [])

  const go = useCallback(
    (path: string, from: Origin | undefined) => place(path, from, currentPath() === path ? 'replace' : 'push'),
    [place],
  )

  const navigate = useCallback((next: Route) => go(pathOf(next), undefined), [go])
  const openFeed = useCallback((feedId: number, from: Origin) => go(feedPathOf(feedId), from), [go])
  const openReader = useCallback((feedItemId: number, from: Origin) => go(readerPathOf(feedItemId), from), [go])
  const returnTo = useCallback(
    (origin: Origin) => {
      if (historyState().beneath !== origin.path) {
        go(origin.path, origin.from)
      } else if (!goingBack.current) {
        goingBack.current = true
        window.history.back()
      }
    },
    [go],
  )

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

  return {
    ...location,
    arrival,
    navigate,
    openFeed,
    openReader,
    returnTo,
    updateSearch,
    searchIn,
    sortSearch,
    showDigest,
  }
}

function currentLocation(): Location {
  return locationOf(currentPath(), trailOf(historyState().origin))
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
    digest: pathname === pathOf('digest') ? digestModeOf(search) : DIGEST_TODAY,
  }
}
