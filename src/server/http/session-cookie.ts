import type { Context } from 'hono'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import type { IssuedSession } from '../auth/sessions.js'

/**
 * The only place the session token is named. Prefixed so it cannot collide
 * with anything else served from a shared host name.
 */
export const SESSION_COOKIE = 'simple_rss_session'

/**
 * `Strict` rather than `Lax`, and it costs nothing here: the cookie is only
 * ever needed by same-origin `fetch` calls the loaded client makes. The one
 * thing `Strict` withholds — the cookie on a top-level navigation from another
 * site — is the document request for a public application shell.
 */
const COOKIE_ATTRIBUTES = {
  httpOnly: true,
  secure: true,
  sameSite: 'Strict',
  path: '/',
} as const

export function readSessionCookie(c: Context): string | undefined {
  return getCookie(c, SESSION_COOKIE)
}

/**
 * Hands the token to one device.
 *
 * The cookie's own lifetime is the session's absolute deadline, so a phone
 * that is closed for a month comes back with nothing to send. The shorter idle
 * deadline is enforced by the server, which is the only side that can be
 * trusted to measure it.
 */
export function writeSessionCookie(c: Context, session: IssuedSession, now: Date): void {
  const maxAge = Math.max(0, Math.floor((session.expiresAt.getTime() - now.getTime()) / 1000))
  setCookie(c, SESSION_COOKIE, session.token, { ...COOKIE_ATTRIBUTES, maxAge })
}

export function clearSessionCookie(c: Context): void {
  deleteCookie(c, SESSION_COOKIE, COOKIE_ATTRIBUTES)
}
