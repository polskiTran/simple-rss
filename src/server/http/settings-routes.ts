import { Hono } from 'hono'
import { updateTimezoneRequestSchema, type InstallationPreferences } from '../../shared/api.js'
import type { Clock } from '../clock.js'
import { UnknownTimezoneError, type InstallationSettingsStore } from '../persistence/installation-settings.js'
import { readJsonBody } from './json-body.js'
import { NO_STORE, unavailable } from './responses.js'

export interface SettingsRouteDependencies {
  /** Absent while the database could not be opened. */
  readonly settings: () => InstallationSettingsStore | undefined
  readonly clock: Clock
}

/**
 * The Owner's installation preferences. Mounted at `/api`, behind
 * `requireSession` like every non-auth route.
 *
 * An installation that was claimed before timezone detection existed — or by a
 * browser that offered none — has no settings row yet; it reads as UTC, which
 * is exactly how the Digest grouped its days all along.
 */
export function settingsRoutes(deps: SettingsRouteDependencies): Hono {
  const app = new Hono()

  app.get('/settings', (c) => {
    const settings = deps.settings()
    if (!settings) return unavailable(c)

    return c.json<InstallationPreferences>({ timezone: settings.effectiveTimezone() }, 200, NO_STORE)
  })

  app.put('/settings/timezone', async (c) => {
    const settings = deps.settings()
    if (!settings) return unavailable(c)

    const body = await readJsonBody(c, updateTimezoneRequestSchema)
    if (!body.ok) return body.response

    try {
      settings.setTimezone(body.value.timezone, deps.clock.now())
    } catch (error) {
      // Only the zone itself is the Owner's mistake; a failing write is the
      // installation's, and belongs to the app-level error answer.
      if (!(error instanceof UnknownTimezoneError)) throw error
      return c.json(
        { error: { code: 'unknown_timezone', message: 'That is not a recognizable IANA timezone' } },
        400,
        NO_STORE,
      )
    }
    return c.json<InstallationPreferences>({ timezone: body.value.timezone }, 200, NO_STORE)
  })

  return app
}
