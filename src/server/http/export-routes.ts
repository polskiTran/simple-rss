import { Hono } from 'hono'
import type { Clock } from '../clock.js'
import { buildOwnerExport } from '../export/owner-export.js'
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
 * The complete JSON download beside the OPML one: the Owner's portable
 * reading state as one attachment. Mounted at `/api`, behind `requireSession`
 * like every non-auth route, and never cached — the file is the Owner's data
 * at this instant, not a resource to revalidate.
 */
export function exportRoutes(deps: ExportRouteDependencies): Hono {
  const app = new Hono()

  app.get('/export', (c) => {
    const database = deps.database()
    const settings = deps.settings()
    if (!database || !settings) return unavailable(c)

    const document = buildOwnerExport({ database, settings, clock: deps.clock })
    return c.body(JSON.stringify(document, null, 2), 200, {
      ...NO_STORE,
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': 'attachment; filename="simple-rss-export.json"',
    })
  })

  return app
}
