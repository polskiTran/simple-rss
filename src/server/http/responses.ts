import type { Context } from 'hono'

/** Nothing the API answers may sit in a cache, shared or private. */
export const NO_STORE = { 'Cache-Control': 'no-store' } as const

/** What an edge helper hands back: a value it accepted, or the response refusing it. */
export type Validated<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly response: Response }

export function unauthenticated(c: Context) {
  return c.json({ error: { code: 'unauthenticated', message: 'Authentication required' } }, 401, NO_STORE)
}

export function unavailable(c: Context) {
  return c.json({ error: { code: 'unavailable', message: 'Service is not ready' } }, 503, NO_STORE)
}

export function invalidCredentials(c: Context) {
  return c.json({ error: { code: 'invalid_credentials', message: 'Invalid credentials' } }, 401, NO_STORE)
}

export function notFound(c: Context) {
  return c.json({ error: { code: 'not_found', message: 'Not found' } }, 404, NO_STORE)
}

/** Headers for a refusal that names a wait: the wait, and never a cache. */
export function retryAfter(seconds: number) {
  return { ...NO_STORE, 'Retry-After': String(seconds) }
}
