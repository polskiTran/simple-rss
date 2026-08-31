import { z } from 'zod'
import { useCallback, useEffect, useState } from 'react'
import { searchQuerySchema } from '../shared/api.js'

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

const MAX_TRAIL = 6

const historyPathSchema = z.string().regex(/^\/[a-z]+(\/[1-9]\d*)?$/)

const historyOriginSchema = z.object({
  path: historyPathSchema,
  label: z.string().min(1),
  from: z.unknown().optional(),
})

const historyStateSchema = z.object({
  origin: z.unknown().optional(),
  search: z.unknown().optional(),
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

interface SearchOrigin {
  readonly path: string
  readonly origin: Origin | undefined
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
  readonly route: 'digest'
  readonly query: string
  readonly from: SearchOrigin
}

interface NavigationActions {
  navigate(route: Route): void
  openFeed(feedId: number, from: Origin): void
  openReader(feedItemId: number, from: Origin): void
  returnTo(origin: Origin): void
  updateSearch(query: string): void
}

export type Navigation = (ScreenLocation | SearchLocation) & NavigationActions

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
    if (window.location.pathname === path) {
      window.history.replaceState(state, '', path)
    } else {
      window.history.pushState(state, '', path)
    }
    setLocation(screenLocationOf(path, origin))
  }, [])

  const navigate = useCallback((next: Route) => go(pathOf(next), undefined), [go])
  const openFeed = useCallback((feedId: number, from: Origin) => go(feedPathOf(feedId), from), [go])
  const openReader = useCallback((feedItemId: number, from: Origin) => go(readerPathOf(feedItemId), from), [go])
  const returnTo = useCallback((origin: Origin) => go(origin.path, origin.from), [go])

  const updateSearch = useCallback(
    (query: string) => {
      if (query.trim() === '') {
        if (location.kind !== 'search') return
        const { from } = location
        const state = from.origin ? { origin: from.origin } : null
        window.history.replaceState(state, '', from.path)
        setLocation(screenLocationOf(from.path, from.origin))
        return
      }

      if (location.kind === 'search') {
        const search = { ...location, query }
        window.history.replaceState({ search: persistedSearch(search) }, '', pathOf('digest'))
        setLocation(search)
        return
      }

      const search = searchLocation(query, searchOriginOf(location))
      window.history.pushState({ search: persistedSearch(search) }, '', pathOf('digest'))
      setLocation(search)
    },
    [location],
  )

  return { ...location, navigate, openFeed, openReader, returnTo, updateSearch }
}

function currentLocation(): Location {
  const state = historyStateSchema.safeParse(window.history.state)
  const data = state.success ? state.data : undefined
  const search = window.location.pathname === pathOf('digest') ? searchOf(data?.search) : undefined
  return search ?? screenLocationOf(window.location.pathname, trailOf(data?.origin))
}

const historySearchSchema = z.object({
  query: searchQuerySchema,
  from: z.object({
    path: historyPathSchema,
    origin: z.unknown().optional(),
  }),
})

function searchOf(value: unknown): SearchLocation | undefined {
  const parsed = historySearchSchema.safeParse(value)
  if (!parsed.success || parsed.data.query.trim() === '') return undefined
  return searchLocation(parsed.data.query, {
    path: parsed.data.from.path,
    origin: trailOf(parsed.data.from.origin),
  })
}

function searchLocation(query: string, from: SearchOrigin): SearchLocation {
  return { kind: 'search', route: 'digest', query, from }
}

function persistedSearch(search: SearchLocation) {
  return { query: search.query, from: search.from }
}

function searchOriginOf(location: ScreenLocation): SearchOrigin {
  if (location.readerItemId !== undefined) {
    return { path: readerPathOf(location.readerItemId), origin: location.origin }
  }
  if (location.feedId !== undefined) {
    return { path: feedPathOf(location.feedId), origin: location.origin }
  }
  return { path: pathOf(location.route), origin: undefined }
}

function screenLocationOf(pathname: string, origin: Origin | undefined): ScreenLocation {
  const readerItemId = readerItemIdOf(pathname)
  const route = readerItemId !== undefined && origin ? routeOf(origin.path) : routeOf(pathname)
  return { kind: 'screen', route, feedId: feedIdOf(pathname), readerItemId, origin }
}
