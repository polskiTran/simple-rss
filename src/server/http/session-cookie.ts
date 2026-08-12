import type { Context } from 'hono'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import type { IssuedSession } from '../auth/sessions.js'

/** The only place the session token is named; prefixed against collisions on a shared host. */
export const SESSION_COOKIE = 'simple_rss_session'

/**
 * `Strict` costs nothing here: only same-origin `fetch` needs the cookie, and
 * the cross-site navigation `Strict` withholds it from fetches a public shell.
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
 * The cookie lifetime is the session's absolute deadline; the shorter idle
 * deadline is enforced server-side, the only side that can be trusted to measure it.
 */
export function writeSessionCookie(c: Context, session: IssuedSession, now: Date): void {
  const maxAge = Math.max(0, Math.floor((session.expiresAt.getTime() - now.getTime()) / 1000))
  setCookie(c, SESSION_COOKIE, session.token, { ...COOKIE_ATTRIBUTES, maxAge })
}

export function clearSessionCookie(c: Context): void {
  deleteCookie(c, SESSION_COOKIE, COOKIE_ATTRIBUTES)
}
