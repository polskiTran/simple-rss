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

/** Reachable without a Session because they are how a Session is obtained. */
export const PUBLIC_API_PATHS: ReadonlySet<string> = new Set([
  '/api/auth/status',
  '/api/auth/setup',
  '/api/auth/session',
])

export interface AuthRouteDependencies {
  /** Absent while the database could not be opened. */
  readonly authentication: () => Authentication | undefined
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
          { error: { code: 'already_claimed', message: 'This installation already has a User' } },
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
        clearSessionCookie(c)
        return status(c, { claimed: true, authenticated: false })
    }
  })

  return app
}

function seedTimezone(settings: InstallationSettingsStore | undefined, timezone: string | undefined, now: Date) {
  if (!settings || !timezone) return
  try {
    settings.setTimezone(timezone, now)
  } catch {}
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
