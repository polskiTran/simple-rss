import { z } from 'zod'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  digestParamsOf,
  digestRequestSchema,
  searchParamsOf,
  searchRequestSchema,
  type DigestStart,
  type SearchScope,
  type SearchSort,
} from '../shared/api.js'

export const ROUTES = ['digest', 'feeds', 'saved', 'settings'] as const
export type Route = (typeof ROUTES)[number]

export const ROUTE_LABELS = {
  digest: 'Digest',
  feeds: 'Feeds',
  saved: 'Saved',
  settings: 'Settings',
} as const satisfies Record<Route, string>

/**
 * The way back out of a nested screen, recursively. Kept in history state, so
 * it survives back, forward and reload.
 */
export interface Origin {
  readonly path: string
  readonly label: string
  readonly from: Origin | undefined
}

/**
 * Where the User stands: a section, or a screen nested under one. A Feed and
 * the Reader always have a way back; a search has one when it left a screen.
 */
type ScreenLocation =
  | { readonly screen: 'digest'; readonly start: DigestStart }
  | { readonly screen: 'feeds' | 'saved' | 'settings' }
  | { readonly screen: 'feed'; readonly feedId: number; readonly origin: Origin }
  | { readonly screen: 'reader'; readonly feedItemId: number; readonly origin: Origin }
  | {
      readonly screen: 'search'
      readonly query: string
      readonly scope: SearchScope
      readonly sort: SearchSort
      readonly origin: Origin | undefined
    }

const HOME: ScreenLocation = { screen: 'digest', start: {} }

export function sectionPath(route: Route): string {
  return `/${route}`
}

export function feedPath(feedId: number): string {
  return `/feeds/${feedId}`
}

export function readerPath(feedItemId: number): string {
  return `/reader/${feedItemId}`
}

/** The Digest's address is its API request, so the way back returns to the same day. */
function digestPath(start: DigestStart): string {
  const params = digestParamsOf(start)
  return params.size > 0 ? `/digest?${params}` : '/digest'
}

/** The search address is the API request: `/search?` followed by the same parameters. */
function searchPath(query: string, scope: SearchScope, sort?: SearchSort): string {
  return `/search?${searchParamsOf(query, scope, sort)}`
}

/**
 * The one reading of an address, the inverse of the path builders above:
 * undefined for anything they could not have built. An unreadable Digest day
 * starts today; a nested screen opened by address takes its section as the way back.
 */
function locationOf(path: string, origin: Origin | undefined): ScreenLocation | undefined {
  const cut = path.indexOf('?')
  const pathname = cut === -1 ? path : path.slice(0, cut)
  const params = new URLSearchParams(cut === -1 ? '' : path.slice(cut))
  const [, section, id] = /^\/([a-z]+)(?:\/([1-9]\d*))?\/?$/.exec(pathname) ?? []

  if (id !== undefined) {
    const nested = Number(id)
    if (!Number.isSafeInteger(nested)) return undefined
    if (section === 'feeds') return { screen: 'feed', feedId: nested, origin: origin ?? sectionOrigin('feeds') }
    if (section === 'reader') return { screen: 'reader', feedItemId: nested, origin: origin ?? sectionOrigin('digest') }
    return undefined
  }

  switch (section) {
    case 'digest': {
      const start = digestRequestSchema.safeParse(Object.fromEntries(params))
      return { screen: 'digest', start: start.success ? start.data : {} }
    }
    case 'feeds':
    case 'saved':
    case 'settings':
      return { screen: section }
    case 'search': {
      const found = searchRequestSchema.safeParse(Object.fromEntries(params))
      if (!found.success || found.data.query.trim() === '') return undefined
      return { screen: 'search', ...found.data, origin }
    }
    default:
      return undefined
  }
}

/** The location at an address the app may not have built itself; anything unreadable is the Digest. */
export function locationAt(path: string): ScreenLocation {
  return locationOf(path, undefined) ?? HOME
}

function sectionOrigin(route: Route): Origin {
  return { path: sectionPath(route), label: ROUTE_LABELS[route], from: undefined }
}

/** The way back to `location`, for a screen opened from it. A Feed is named by its title once it is known. */
export function originOf(location: ScreenLocation, feedTitle = 'Feed'): Origin {
  switch (location.screen) {
    case 'digest':
      return { ...sectionOrigin('digest'), path: digestPath(location.start) }
    case 'feeds':
    case 'saved':
    case 'settings':
      return sectionOrigin(location.screen)
    case 'feed':
      return { path: feedPath(location.feedId), label: feedTitle, from: location.origin }
    case 'reader':
      return { path: readerPath(location.feedItemId), label: 'Reader', from: location.origin }
    case 'search':
      return {
        path: searchPath(location.query, location.scope, location.sort),
        label: 'Search',
        from: location.origin,
      }
  }
}

/** The tab a location reads under. The Reader takes the section it was opened from, and a search its scope's own. */
export function sectionOf(location: ScreenLocation): Route {
  switch (location.screen) {
    case 'digest':
    case 'feeds':
    case 'saved':
    case 'settings':
      return location.screen
    case 'feed':
      return 'feeds'
    case 'reader': {
      const beneath = locationAt(location.origin.path)
      return beneath.screen === 'search' ? 'digest' : sectionOf(beneath)
    }
    case 'search':
      return SECTION_OF_SCOPE[location.scope.kind]
  }
}

const SECTION_OF_SCOPE = {
  everywhere: 'digest',
  saved: 'saved',
  subscriptions: 'feeds',
  feed: 'feeds',
} as const satisfies Record<SearchScope['kind'], Route>

/** What the search line searches from a location. */
export function scopeOf(location: ScreenLocation): SearchScope {
  switch (location.screen) {
    case 'search':
      return location.scope
    case 'feed':
      return { kind: 'feed', feedId: location.feedId }
    case 'saved':
      return { kind: 'saved' }
    case 'feeds':
      return { kind: 'subscriptions' }
    case 'digest':
    case 'settings':
    case 'reader':
      return { kind: 'everywhere' }
  }
}

const MAX_TRAIL = 6

const historyOriginSchema = z.object({
  path: z.string().refine((path) => locationOf(path, undefined) !== undefined),
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

function currentLocation(): ScreenLocation {
  return locationOf(currentPath(), trailOf(historyState().origin)) ?? HOME
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

export interface Navigation {
  readonly location: ScreenLocation
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
  /** Starts the Digest from another day, in place: a day picked is not a trail to walk back. */
  showDigest(start: DigestStart): void
}

export function useNavigation(): Navigation {
  const [location, setLocation] = useState(currentLocation)
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
    setLocation(locationOf(path, origin) ?? HOME)
  }, [])

  const go = useCallback(
    (path: string, from: Origin | undefined) => place(path, from, currentPath() === path ? 'replace' : 'push'),
    [place],
  )

  const navigate = useCallback((next: Route) => go(sectionPath(next), undefined), [go])
  const openFeed = useCallback((feedId: number, from: Origin) => go(feedPath(feedId), from), [go])
  const openReader = useCallback((feedItemId: number, from: Origin) => go(readerPath(feedItemId), from), [go])
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
      if (location.screen !== 'search') {
        // The results surface shows no way-back link, so the origin's label is never read.
        if (query.trim() !== '') go(searchPath(query, scopeOf(location)), originOf(location))
        return
      }
      if (query.trim() === '') {
        go(location.origin?.path ?? sectionPath('digest'), location.origin?.from)
        return
      }
      // Refining a search rewrites its entry rather than stacking one per pause.
      place(searchPath(query, location.scope, location.sort), location.origin, 'replace')
    },
    [location, go, place],
  )

  const searchIn = useCallback(
    (scope: SearchScope) => {
      if (location.screen !== 'search') return
      place(searchPath(location.query, scope, location.sort), location.origin, 'replace')
    },
    [location, place],
  )

  const sortSearch = useCallback(
    (sort: SearchSort) => {
      if (location.screen !== 'search') return
      place(searchPath(location.query, location.scope, sort), location.origin, 'replace')
    },
    [location, place],
  )

  const showDigest = useCallback((start: DigestStart) => place(digestPath(start), undefined, 'replace'), [place])

  return {
    location,
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
