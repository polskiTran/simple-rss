import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { POLLING_INTERVAL_MINUTES } from '../../../src/shared/api.js'
import { openDatabase } from '../../../src/server/persistence/database.js'
import { applyMigrations, migrations } from '../../../src/server/persistence/migrations.js'
import { makeTempDataDir } from '../../support/temp-dir.js'

function pollingIntervalLists(sql: string): number[][] {
  return [...sql.matchAll(/polling_interval_minutes IN \(([^)]+)\)/g)].map((match) =>
    (match[1] ?? '').split(',').map((part) => Number(part.trim())),
  )
}

describe('the released polling interval CHECK', () => {
  it('lists the same minutes as POLLING_INTERVAL_MINUTES', async () => {
    const released = migrations.flatMap((migration) => pollingIntervalLists(migration.sql))
    expect(released).toEqual([[...POLLING_INTERVAL_MINUTES]])

    const db = openDatabase(join(await makeTempDataDir(), 'simple-rss.db'))
    applyMigrations(db)
    const table = db.$client.prepare("SELECT sql FROM sqlite_master WHERE name = 'subscriptions'").get() as {
      sql: string
    }
    expect(pollingIntervalLists(table.sql)).toEqual([[...POLLING_INTERVAL_MINUTES]])
    db.$client.close()
  })
})
