import type { MiddlewareHandler } from 'hono'
import type { Authentication } from '../auth/authentication.js'
import { apiError } from './requests.js'
import { readSessionCookie } from './session-cookie.js'

/**
 * The ADR 0004 allowlist: the only `/api` paths reachable without a Session,
 * because they are how a Session is obtained. Exact paths, never prefixes.
 */
const PUBLIC_API_PATHS: ReadonlySet<string> = new Set(['/api/auth/status', '/api/auth/setup', '/api/auth/session'])

/** Closes every `/api` route it is mounted over unless its path is on the allowlist. */
export function requireSession(authentication: Authentication): MiddlewareHandler {
  return async (c, next) => {
    if (PUBLIC_API_PATHS.has(c.req.path) || authentication.authenticate(readSessionCookie(c))) return next()
    return apiError(c, 401, 'unauthenticated', 'Authentication required')
  }
}
