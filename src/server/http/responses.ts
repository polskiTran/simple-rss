import type { Context } from 'hono'

/** Nothing the API answers may sit in a cache, shared or private. */
export const NO_STORE = { 'Cache-Control': 'no-store' } as const

export function unauthenticated(c: Context) {
  return c.json({ error: { code: 'unauthenticated', message: 'Authentication required' } }, 401, NO_STORE)
}

export function unavailable(c: Context) {
  return c.json({ error: { code: 'unavailable', message: 'Service is not ready' } }, 503, NO_STORE)
}

export function invalidCredentials(c: Context) {
  return c.json({ error: { code: 'invalid_credentials', message: 'Invalid credentials' } }, 401, NO_STORE)
}
