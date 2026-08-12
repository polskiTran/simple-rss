import { Hono } from 'hono'
import type { Clock } from '../clock.js'
import { buildUserExport } from '../export/user-export.js'
import type { SqliteDatabase } from '../persistence/database.js'
import type { InstallationSettingsStore } from '../persistence/installation-settings.js'
import { NO_STORE, unavailable } from './responses.js'

export interface ExportRouteDependencies {
  /** Absent while the database could not be opened. */
  readonly database: () => SqliteDatabase | undefined
  readonly settings: () => InstallationSettingsStore | undefined
  readonly clock: Clock
}

/**
 * The complete JSON export beside the OPML one. Mounted at `/api` behind
 * `requireSession`, never cached.
 */
export function exportRoutes(deps: ExportRouteDependencies): Hono {
  const app = new Hono()

  app.get('/export', (c) => {
    const database = deps.database()
    const settings = deps.settings()
    if (!database || !settings) return unavailable(c)

    const document = buildUserExport({ database, settings, clock: deps.clock })
    return c.body(JSON.stringify(document, null, 2), 200, {
      ...NO_STORE,
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': 'attachment; filename="simple-rss-export.json"',
    })
  })

  return app
}
