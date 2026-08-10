import type { MiddlewareHandler } from 'hono'
import type { Authentication } from '../auth/authentication.js'
import { unauthenticated, unavailable } from './responses.js'
import { readSessionCookie } from './session-cookie.js'

export interface RequireSessionOptions {
  /** Absent while the database could not be opened. */
  readonly authentication: () => Authentication | undefined
  /** Paths that must stay reachable without a session, such as signing in. */
  readonly isPublic: (path: string) => boolean
}

/**
 * Closes the API to anyone who is not the User.
 *
 * This is the whole access model: one door, in front of everything except the
 * handful of routes that exist to get through it. An unclaimed installation
 * therefore exposes nothing but setup and health, because no session can exist
 * before there is a User to issue one to.
 */
export function requireSession(options: RequireSessionOptions): MiddlewareHandler {
  return async (c, next) => {
    if (options.isPublic(c.req.path)) return next()

    const authentication = options.authentication()
    if (!authentication) return unavailable(c)

    if (!authentication.authenticate(readSessionCookie(c))) return unauthenticated(c)

    return next()
  }
}
