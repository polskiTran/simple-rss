import type { MiddlewareHandler } from 'hono'
import type { Authentication } from '../auth/authentication.js'
import { unauthenticated } from './responses.js'
import { readSessionCookie } from './session-cookie.js'

export interface RequireSessionOptions {
  readonly authentication: Authentication
  /** Paths that must stay reachable without a session, such as signing in. */
  readonly isPublic: (path: string) => boolean
}

export function requireSession(options: RequireSessionOptions): MiddlewareHandler {
  return async (c, next) => {
    if (options.isPublic(c.req.path)) return next()

    if (!options.authentication.authenticate(readSessionCookie(c))) return unauthenticated(c)

    return next()
  }
}
