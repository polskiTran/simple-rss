import type { MiddlewareHandler } from 'hono'
import type { Authentication } from '../auth/authentication.js'
import { apiError } from './requests.js'
import { readSessionCookie } from './session-cookie.js'

const PUBLIC_API_PATHS: ReadonlySet<string> = new Set(['/api/auth/status', '/api/auth/setup', '/api/auth/session'])

export function requireSession(authentication: Authentication): MiddlewareHandler {
  return async (c, next) => {
    if (PUBLIC_API_PATHS.has(c.req.path) || authentication.authenticate(readSessionCookie(c))) return next()
    return apiError(c, 401, 'unauthenticated', 'Authentication required')
  }
}
