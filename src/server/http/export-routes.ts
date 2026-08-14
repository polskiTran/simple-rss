import { Hono } from 'hono'
import type { Clock } from '../clock.js'
import { buildUserExport } from '../export/user-export.js'
import type { SqliteDatabase } from '../persistence/database.js'
import type { InstallationSettingsStore } from '../persistence/installation-settings.js'
import { NO_STORE } from './responses.js'

export interface ExportRouteDependencies {
  readonly database: SqliteDatabase
  readonly settings: InstallationSettingsStore
  readonly clock: Clock
}

/**
 * The complete JSON export beside the OPML one. Mounted at `/api` behind
 * `requireSession`, never cached.
 */
export function exportRoutes(deps: ExportRouteDependencies): Hono {
  const app = new Hono()

  app.get('/export', (c) => {
    const document = buildUserExport({ database: deps.database, settings: deps.settings, clock: deps.clock })
    return c.body(JSON.stringify(document, null, 2), 200, {
      ...NO_STORE,
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': 'attachment; filename="simple-rss-export.json"',
    })
  })

  return app
}
