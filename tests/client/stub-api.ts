import { vi } from 'vitest'
import type { z } from 'zod'
import type {
  ApiErrorBody,
  AuthStatus,
  createSubscriptionResponseSchema,
  digestCalendarSchema,
  digestSchema,
  feedDetailSchema,
  FeedDetailsUpdate,
  feedItemsSchema,
  feedPreviewResponseSchema,
  InstallationPreferences,
  librarySchema,
  LibraryMembership,
  OpmlImportReport,
  PollingSchedule,
  ReaderArticle,
  readerItemSchema,
  ReadingSourcePreference,
  RefreshFeedResponse,
  searchResultsSchema,
  ServiceMeta,
  subscriptionListSchema,
} from '../../src/shared/api.js'
import { digest, library } from './fixtures.js'

interface Answers {
  'GET /api/auth/status': AuthStatus
  'POST /api/auth/setup': AuthStatus
  'POST /api/auth/session': AuthStatus
  'DELETE /api/auth/session': undefined
  'POST /api/auth/password': AuthStatus
  'GET /api/meta': ServiceMeta
  'GET /api/settings': InstallationPreferences
  'PUT /api/settings/timezone': InstallationPreferences
  'GET /api/feeds': z.input<typeof subscriptionListSchema>
  'POST /api/subscriptions/preview': z.input<typeof feedPreviewResponseSchema>
  'POST /api/subscriptions': z.input<typeof createSubscriptionResponseSchema>
  'POST /api/subscriptions/import': OpmlImportReport
  [route: `GET /api/feeds/${number}`]: z.input<typeof feedDetailSchema>
  [route: `GET /api/feeds/${number}/items`]: z.input<typeof feedItemsSchema>
  [route: `GET /api/feeds/${number}/items?${string}`]: z.input<typeof feedItemsSchema>
  [route: `DELETE /api/feeds/${number}`]: undefined
  [route: `POST /api/feeds/${number}/refresh`]: RefreshFeedResponse
  [route: `PUT /api/feeds/${number}/details`]: FeedDetailsUpdate
  [route: `PUT /api/feeds/${number}/interval`]: PollingSchedule
  [route: `PUT /api/feeds/${number}/reading-source`]: ReadingSourcePreference
  'GET /api/digest': z.input<typeof digestSchema>
  [route: `GET /api/digest?${string}`]: z.input<typeof digestSchema>
  'GET /api/digest/days': z.input<typeof digestCalendarSchema>
  'GET /api/library': z.input<typeof librarySchema>
  [route: `GET /api/library?${string}`]: z.input<typeof librarySchema>
  [route: `PUT /api/library/${number}`]: LibraryMembership
  [route: `DELETE /api/library/${number}`]: LibraryMembership
  [route: `GET /api/search?${string}`]: z.input<typeof searchResultsSchema>
  [route: `GET /api/items/${number}`]: z.input<typeof readerItemSchema>
  [route: `GET /api/items/${number}/reader`]: ReaderArticle
}

type RouteKey = keyof Answers

export interface StubbedRequest {
  readonly method: string
  readonly path: string
  readonly body: unknown
}

export type Reply<T> =
  | { readonly status?: 200 | 201; readonly body: T; readonly headers?: Record<string, string> }
  | { readonly status: number; readonly body?: ApiErrorBody; readonly headers?: Record<string, string> }

export type Route<T> = Reply<T> | ((request: StubbedRequest) => Reply<T> | Promise<Reply<T>>)

type AnyRoute = Route<unknown>

export class StubbedApi {
  readonly #routes = new Map<string, AnyRoute>()
  readonly #requests: StubbedRequest[] = []

  constructor(status: AuthStatus = { claimed: true, authenticated: true }) {
    this.authStatus(status)
    this.on('GET /api/meta', { body: { name: 'simple-rss', version: '0.1.0' } })
    this.on('GET /api/feeds', { body: { subscriptions: [] } })
    this.on('GET /api/digest', { body: digest({ groups: [] }) })
    this.on('GET /api/digest/days', { body: { today: '2026-08-08', days: [], subscriptions: 1 } })
    this.on('GET /api/library', { body: library({ total: 0, items: [] }) })
    this.on('GET /api/settings', { body: { timezone: 'UTC' } })
  }

  on<R extends RouteKey>(route: R, reply: Route<Answers[R]>): this {
    this.#routes.set(route, reply)
    return this
  }

  malformed(route: RouteKey): this {
    this.#routes.set(route, { body: { unexpected: true } })
    return this
  }

  authStatus(status: AuthStatus): this {
    return this.on('GET /api/auth/status', { body: status })
  }

  get requests(): readonly StubbedRequest[] {
    return this.#requests
  }

  requestsTo(route: RouteKey): readonly StubbedRequest[] {
    return this.#requests.filter((request) => `${request.method} ${request.path}` === route)
  }

  install(): void {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
        const path = String(input)
        const method = init.method ?? 'GET'
        const body = typeof init.body === 'string' ? JSON.parse(init.body) : undefined
        const request: StubbedRequest = { method, path, body }
        this.#requests.push(request)

        const route = this.#routes.get(`${method} ${path}`)
        if (!route) return new Response(null, { status: 404 })

        const reply = await answer(route, request, init.signal)
        const { status = 200, body: replyBody, headers = {} } = reply
        return new Response(replyBody === undefined ? null : JSON.stringify(replyBody), { status, headers })
      }),
    )
  }
}

async function answer(
  route: AnyRoute,
  request: StubbedRequest,
  signal: AbortSignal | null | undefined,
): Promise<Reply<unknown>> {
  const work = Promise.resolve(typeof route === 'function' ? route(request) : route)
  if (!signal) return work
  if (signal.aborted) throw signal.reason

  const aborted = Promise.withResolvers<never>()
  const onAbort = () => aborted.reject(signal.reason)
  signal.addEventListener('abort', onAbort, { once: true })
  try {
    return await Promise.race([work, aborted.promise])
  } finally {
    signal.removeEventListener('abort', onAbort)
  }
}

export function stubApi(status?: AuthStatus): StubbedApi {
  const api = status ? new StubbedApi(status) : new StubbedApi()
  api.install()
  return api
}
