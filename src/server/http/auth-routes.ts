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
import { apiError, readJsonBody } from './requests.js'
import { clearSessionCookie, readSessionCookie, writeSessionCookie } from './session-cookie.js'

export interface AuthRouteDependencies {
  readonly authentication: Authentication
  readonly settings: InstallationSettingsStore
  readonly clock: Clock
  readonly trustProxyHeaders: boolean
}

/**
 * Setup, sign-in, sign-out, and the password change. Mounted at `/api/auth`;
 * which of these answer without a Session is `require-session.ts`'s call.
 */
export function authRoutes(deps: AuthRouteDependencies): Hono {
  const app = new Hono()

  app.get('/status', (c) => status(c, deps.authentication.status(readSessionCookie(c))))

  app.post('/setup', async (c) => {
    const body = await readJsonBody(c, claimRequestSchema)
    if (!body.ok) return body.response

    const outcome = await deps.authentication.claim({
      ...body.value,
      client: clientAddress(c, deps.trustProxyHeaders),
    })

    switch (outcome.kind) {
      case 'claimed':
        seedTimezone(deps.settings, body.value.timezone, deps.clock.now())
        writeSessionCookie(c, outcome.session, deps.clock.now())
        return status(c, { claimed: true, authenticated: true }, 201)
      case 'already-claimed':
        return apiError(c, 409, 'already_claimed', 'This installation already has a User')
      case 'unavailable':
        return apiError(c, 503, 'setup_unavailable', outcome.reason)
      case 'rate-limited':
        return tooManyAttempts(c, outcome.retryAfterSeconds)
      case 'rejected':
        return invalidCredentials(c)
    }
  })

  app.post('/session', async (c) => {
    const body = await readJsonBody(c, signInRequestSchema)
    if (!body.ok) return body.response

    const outcome = await deps.authentication.signIn({
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
    deps.authentication.signOut(readSessionCookie(c))
    clearSessionCookie(c)
    return c.body(null, 204)
  })

  app.post('/password', async (c) => {
    const body = await readJsonBody(c, passwordChangeRequestSchema)
    if (!body.ok) return body.response

    const outcome = await deps.authentication.changePassword({
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

function seedTimezone(settings: InstallationSettingsStore, timezone: string | undefined, now: Date) {
  if (!timezone) return
  try {
    settings.setTimezone(timezone, now)
  } catch {}
}

function status(c: Context, body: AuthStatus, code: 200 | 201 = 200) {
  return c.json<AuthStatus>(body, code)
}

function tooManyAttempts(c: Context, retryAfterSeconds: number) {
  return apiError(c, 429, 'too_many_attempts', 'Too many attempts', { 'Retry-After': String(retryAfterSeconds) })
}

function invalidCredentials(c: Context) {
  return apiError(c, 401, 'invalid_credentials', 'Invalid credentials')
}
