import type { Context } from 'hono'

/** Nothing the API answers may sit in a cache, shared or private. */
export const NO_STORE = { 'Cache-Control': 'no-store' } as const

/**
 * The refusals more than one guard has to be able to give, written once so
 * that a caller cannot tell which guard turned it away by the shape of the
 * answer.
 */
export function unauthenticated(c: Context) {
  return c.json({ error: { code: 'unauthenticated', message: 'Authentication required' } }, 401, NO_STORE)
}

export function unavailable(c: Context) {
  return c.json({ error: { code: 'unavailable', message: 'Service is not ready' } }, 503, NO_STORE)
}

/**
 * The one answer every failed credential gets, whatever was actually wrong:
 * no User yet, wrong password, wrong setup secret. Distinguishing them would
 * tell someone guessing which half of the problem to work on.
 */
export function invalidCredentials(c: Context) {
  return c.json({ error: { code: 'invalid_credentials', message: 'Invalid credentials' } }, 401, NO_STORE)
}
