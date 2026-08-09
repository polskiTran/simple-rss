import { Hono, type Context } from 'hono'
import {
  claimRequestSchema,
  passwordChangeRequestSchema,
  signInRequestSchema,
  type AuthStatus,
} from '../../shared/api.js'
import type { Authentication } from '../auth/authentication.js'
import type { Clock } from '../clock.js'
import type { InstallationSettingsStore } from '../persistence/installation-settings.js'
import { clientAddress } from './client-address.js'
import { readJsonBody } from './json-body.js'
import { invalidCredentials, NO_STORE, unavailable } from './responses.js'
import { clearSessionCookie, readSessionCookie, writeSessionCookie } from './session-cookie.js'

/**
 * The routes that must stay reachable without a session, because they are how
 * a session is obtained. Everything else under `/api` — including changing the
 * password, which is an Owner action — is closed by `requireSession`.
 *
 * Listed as exact paths rather than a prefix, so mounting a new route under
 * `/api/auth` leaves it guarded until it is named here deliberately.
 */
export const PUBLIC_API_PATHS: ReadonlySet<string> = new Set([
  '/api/auth/status',
  '/api/auth/setup',
  '/api/auth/session',
])

export interface AuthRouteDependencies {
  /** Absent while the database could not be opened. */
  readonly authentication: () => Authentication | undefined
  /** Where a successful claim seeds the detected installation timezone. */
  readonly settings: () => InstallationSettingsStore | undefined
  readonly clock: Clock
  readonly trustProxyHeaders: boolean
}

/** Setup, sign-in, sign-out, and the password change. Mounted at `/api/auth`. */
export function authRoutes(deps: AuthRouteDependencies): Hono {
  const app = new Hono()

  app.get('/status', (c) => {
    const authentication = deps.authentication()
    if (!authentication) return unavailable(c)

    return status(c, authentication.status(readSessionCookie(c)))
  })

  app.post('/setup', async (c) => {
    const authentication = deps.authentication()
    if (!authentication) return unavailable(c)

    const body = await readJsonBody(c, claimRequestSchema)
    if (!body.ok) return body.response

    const outcome = await authentication.claim({
      ...body.value,
      client: clientAddress(c, deps.trustProxyHeaders),
    })

    switch (outcome.kind) {
      case 'claimed':
        seedTimezone(deps.settings(), body.value.timezone, deps.clock.now())
        writeSessionCookie(c, outcome.session, deps.clock.now())
        return status(c, { claimed: true, authenticated: true }, 201)
      case 'already-claimed':
        return c.json(
          { error: { code: 'already_claimed', message: 'This installation already has an Owner' } },
          409,
          NO_STORE,
        )
      case 'unavailable':
        return c.json({ error: { code: 'setup_unavailable', message: outcome.reason } }, 503, NO_STORE)
      case 'rate-limited':
        return tooManyAttempts(c, outcome.retryAfterSeconds)
      case 'rejected':
        return invalidCredentials(c)
    }
  })

  app.post('/session', async (c) => {
    const authentication = deps.authentication()
    if (!authentication) return unavailable(c)

    const body = await readJsonBody(c, signInRequestSchema)
    if (!body.ok) return body.response

    const outcome = await authentication.signIn({
      password: body.value.password,
      client: clientAddress(c, deps.trustProxyHeaders),
    })

    switch (outcome.kind) {
      case 'signed-in':
        writeSessionCookie(c, outcome.session, deps.clock.now())
        return status(c, { claimed: true, authenticated: true })
      case 'rate-limited':
        return tooManyAttempts(c, outcome.retryAfterSeconds)
      case 'rejected':
        return invalidCredentials(c)
    }
  })

  // Signing out an already-signed-out device is a success: the device wanted
  // to hold no session, and it holds none.
  app.delete('/session', (c) => {
    deps.authentication()?.signOut(readSessionCookie(c))
    clearSessionCookie(c)
    return c.body(null, 204, NO_STORE)
  })

  app.post('/password', async (c) => {
    const authentication = deps.authentication()
    if (!authentication) return unavailable(c)

    const body = await readJsonBody(c, passwordChangeRequestSchema)
    if (!body.ok) return body.response

    const outcome = await authentication.changePassword({
      ...body.value,
      client: clientAddress(c, deps.trustProxyHeaders),
    })

    switch (outcome.kind) {
      case 'rejected':
        return invalidCredentials(c)
      case 'rate-limited':
        return tooManyAttempts(c, outcome.retryAfterSeconds)
      case 'changed':
        // Every session went, including this one. The device is told plainly
        // rather than left holding a cookie the server has already forgotten.
        clearSessionCookie(c)
        return status(c, { claimed: true, authenticated: false })
    }
  })

  return app
}

/**
 * Setup detection is best-effort: a zone this runtime cannot resolve — or a
 * browser that offered none — leaves the installation on UTC rather than
 * failing the one claim this installation will ever accept.
 */
function seedTimezone(settings: InstallationSettingsStore | undefined, timezone: string | undefined, now: Date) {
  if (!settings || !timezone) return
  try {
    settings.setTimezone(timezone, now)
  } catch {
    // The claim stands; the Owner can still pick a timezone in Settings.
  }
}

function status(c: Context, body: AuthStatus, code: 200 | 201 = 200) {
  return c.json<AuthStatus>(body, code, NO_STORE)
}

function tooManyAttempts(c: Context, retryAfterSeconds: number) {
  return c.json({ error: { code: 'too_many_attempts', message: 'Too many attempts' } }, 429, {
    ...NO_STORE,
    'Retry-After': String(retryAfterSeconds),
  })
}
