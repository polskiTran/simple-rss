import { Hono } from 'hono'
import { updateTimezoneRequestSchema, type InstallationPreferences } from '../../shared/api.js'
import type { Clock } from '../clock.js'
import { UnknownTimezoneError, type InstallationSettingsStore } from '../persistence/installation-settings.js'
import { apiError, readJsonBody } from './requests.js'

export interface SettingsRouteDependencies {
  readonly settings: InstallationSettingsStore
  readonly clock: Clock
}

/** Installation preferences, mounted at `/api` behind `requireSession`. */
export function settingsRoutes(deps: SettingsRouteDependencies): Hono {
  const app = new Hono()

  app.get('/settings', (c) => c.json<InstallationPreferences>({ timezone: deps.settings.effectiveTimezone() }))

  app.put('/settings/timezone', async (c) => {
    const body = await readJsonBody(c, updateTimezoneRequestSchema)
    if (!body.ok) return body.response

    try {
      deps.settings.setTimezone(body.value.timezone, deps.clock.now())
    } catch (error) {
      if (!(error instanceof UnknownTimezoneError)) throw error
      return apiError(c, 400, 'unknown_timezone', 'That is not a recognizable IANA timezone')
    }
    return c.json<InstallationPreferences>({ timezone: body.value.timezone })
  })

  return app
}
