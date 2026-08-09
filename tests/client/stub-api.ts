import { vi } from 'vitest'
import type { AuthStatus } from '../../src/shared/api.js'

export interface StubbedRequest {
  readonly method: string
  readonly path: string
  readonly body: unknown
}

export type Reply = { readonly status?: number; readonly body?: unknown; readonly headers?: Record<string, string> }

export type Route = Reply | ((request: StubbedRequest) => Reply | Promise<Reply>)

/**
 * The server, as the client sees it: a map from `METHOD /path` to a reply.
 *
 * The shell decides which screen to show from what `/api/auth/status` answers,
 * so a client test has to be able to state that answer precisely — and to
 * change it, the way signing in does.
 */
export class StubbedApi {
  readonly #routes = new Map<string, Route>()
  readonly #requests: StubbedRequest[] = []

  constructor(status: AuthStatus = { claimed: true, authenticated: true }) {
    this.authStatus(status)
    this.on('GET /api/meta', { body: { name: 'simple-rss', version: '0.1.0' } })
    this.on('GET /api/feeds', { body: { subscriptions: [] } })
    this.on('GET /api/digest', { body: { today: { date: '2026-08-08', volume: 0 }, groups: [] } })
    this.on('GET /api/settings', { body: { timezone: 'UTC' } })
  }

  on(route: string, reply: Route): this {
    this.#routes.set(route, reply)
    return this
  }

  /** Sets what the shell will be told on its next check. */
  authStatus(status: AuthStatus): this {
    return this.on('GET /api/auth/status', { body: status })
  }

  get requests(): readonly StubbedRequest[] {
    return this.#requests
  }

  requestsTo(route: string): readonly StubbedRequest[] {
    return this.#requests.filter((request) => `${request.method} ${request.path}` === route)
  }

  /** Replaces `globalThis.fetch` for the duration of the test. */
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

        const reply = typeof route === 'function' ? await route(request) : route
        const { status = 200, body: replyBody, headers = {} } = reply
        return new Response(replyBody === undefined ? null : JSON.stringify(replyBody), { status, headers })
      }),
    )
  }
}

/** Installs a stub and returns it, for the common one-liner case. */
export function stubApi(status?: AuthStatus): StubbedApi {
  const api = status ? new StubbedApi(status) : new StubbedApi()
  api.install()
  return api
}
