import { z } from 'zod'
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
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

export interface Origin {
  readonly path: string
  readonly label?: string
  readonly from: Origin | undefined
}

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

function digestPath(start: DigestStart): string {
  const params = digestParamsOf(start)
  return params.size > 0 ? `/digest?${params}` : '/digest'
}

function searchPath(query: string, scope: SearchScope, sort?: SearchSort): string {
  return `/search?${searchParamsOf(query, scope, sort)}`
}

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

export function locationAt(path: string): ScreenLocation {
  return locationOf(path, undefined) ?? HOME
}

function sectionOrigin(route: Route): Origin {
  return { path: sectionPath(route), label: ROUTE_LABELS[route], from: undefined }
}

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

export function searchHomeOf(location: ScreenLocation): string {
  if (location.screen !== 'search') return originOf(location).path
  return location.origin?.path ?? sectionPath('digest')
}

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

const historyStateSchema = z.object({
  origin: z.unknown().optional(),
  beneath: z.string().optional(),
  scrollY: z.number().optional(),
  kept: z.record(z.unknown()).optional(),
})

function historyState() {
  const parsed = historyStateSchema.safeParse(window.history.state)
  return parsed.success ? parsed.data : {}
}

const keptListeners = new Set<() => void>()

function subscribeKept(listener: () => void) {
  keptListeners.add(listener)
  window.addEventListener('popstate', listener)
  return () => {
    keptListeners.delete(listener)
    window.removeEventListener('popstate', listener)
  }
}

function keptChanged() {
  for (const listener of keptListeners) listener()
}

export function useKept<T extends string | number | boolean>(
  name: string,
  schema: z.ZodType<T, z.ZodTypeDef, unknown>,
) {
  const value = useSyncExternalStore(subscribeKept, () => schema.safeParse(historyState().kept?.[name]).data)
  const keep = useCallback(
    (next: T | undefined) => {
      const here = historyState()
      window.history.replaceState({ ...here, kept: { ...here.kept, [name]: next } }, '')
      keptChanged()
    },
    [name],
  )
  return [value, keep] as const
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

export interface Arrival {
  readonly scrollY: number | undefined
}

export interface Navigation {
  readonly location: ScreenLocation
  readonly arrival: Arrival | undefined
  navigate(route: Route): void
  openFeed(feedId: number, from: Origin): void
  openReader(feedItemId: number, from: Origin): void
  stepReader(feedItemId: number): void
  returnTo(origin: Origin): void
  updateSearch(query: string): void
  searchIn(scope: SearchScope): void
  sortSearch(sort: SearchSort): void
  showDigest(start: DigestStart): void
}

export function useNavigation(): Navigation {
  const [location, setLocation] = useState(currentLocation)
  const [arrival, setArrival] = useState<Arrival>()
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
      const kept = path === currentPath() ? here.kept : undefined
      window.history.replaceState({ origin, beneath: here.beneath, kept }, '', path)
      keptChanged()
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
  const stepReader = useCallback(
    (feedItemId: number) => {
      if (location.screen !== 'reader') return
      place(readerPath(feedItemId), location.origin, 'replace')
      setArrival({ scrollY: 0 })
    },
    [location, place],
  )
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
        if (query.trim() !== '') go(searchPath(query, scopeOf(location)), originOf(location))
        return
      }
      if (query.trim() === '') {
        go(searchHomeOf(location), location.origin?.from)
        return
      }
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
    stepReader,
    returnTo,
    updateSearch,
    searchIn,
    sortSearch,
    showDigest,
  }
}
