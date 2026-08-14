import { useCallback, useEffect, useState } from 'react'

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

function trailOf(value: unknown, depth = 0): Origin | undefined {
  if (depth >= MAX_TRAIL || typeof value !== 'object' || value === null) return undefined
  const { path, label, from } = value as Record<string, unknown>
  if (typeof path !== 'string' || !/^\/[a-z]+(\/[1-9]\d*)?$/.test(path)) return undefined
  if (typeof label !== 'string' || label === '') return undefined
  return { path, label, from: trailOf(from, depth + 1) }
}

export interface Navigation {
  readonly route: Route
  readonly feedId: number | undefined
  readonly readerItemId: number | undefined
  /** Set while a nested screen is open. */
  readonly origin: Origin | undefined
  navigate(route: Route): void
  openFeed(feedId: number, from: Origin): void
  openReader(feedItemId: number, from: Origin): void
  returnTo(origin: Origin): void
}

interface Location {
  readonly route: Route
  readonly feedId: number | undefined
  readonly readerItemId: number | undefined
  readonly origin: Origin | undefined
}

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
    setLocation(locationOf(path, origin))
  }, [])

  const navigate = useCallback((next: Route) => go(pathOf(next), undefined), [go])
  const openFeed = useCallback((feedId: number, from: Origin) => go(feedPathOf(feedId), from), [go])
  const openReader = useCallback((feedItemId: number, from: Origin) => go(readerPathOf(feedItemId), from), [go])
  const returnTo = useCallback((origin: Origin) => go(origin.path, origin.from), [go])

  return { ...location, navigate, openFeed, openReader, returnTo }
}

function currentLocation(): Location {
  const state = window.history.state as { origin?: unknown } | null
  return locationOf(window.location.pathname, trailOf(state?.origin))
}

function locationOf(pathname: string, origin: Origin | undefined): Location {
  const readerItemId = readerItemIdOf(pathname)
  const route = readerItemId !== undefined && origin ? routeOf(origin.path) : routeOf(pathname)
  return { route, feedId: feedIdOf(pathname), readerItemId, origin }
}
