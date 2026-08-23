import { drizzle } from 'drizzle-orm/better-sqlite3'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { openDatabase, type SqliteDatabase } from '../../../src/server/persistence/database.js'
import { applyMigrations } from '../../../src/server/persistence/migrations.js'
import { InstallationSettingsStore } from '../../../src/server/persistence/installation-settings.js'
import { makeTempDataDir } from '../../support/temp-dir.js'

const AT = new Date('2026-08-08T09:00:00.000Z')
const LATER = new Date('2026-08-09T09:00:00.000Z')

describe('InstallationSettingsStore', () => {
  let dataDir: string
  let db: SqliteDatabase
  let store: InstallationSettingsStore

  beforeEach(async () => {
    dataDir = await makeTempDataDir()
    db = openDatabase(join(dataDir, 'simple-rss.db'))
    applyMigrations(db)
    store = new InstallationSettingsStore(drizzle(db))
  })

  it('reports no settings before the installation is seeded', () => {
    expect(store.read()).toBeUndefined()
  })

  it('seeds the singleton row', () => {
    store.setTimezone('Europe/Berlin', AT)

    expect(store.read()).toEqual({
      timezone: 'Europe/Berlin',
      createdAt: AT.toISOString(),
      updatedAt: AT.toISOString(),
    })
  })

  it('updates the timezone in place and keeps the original creation time', () => {
    store.setTimezone('Europe/Berlin', AT)

    store.setTimezone('Asia/Ho_Chi_Minh', LATER)

    expect(store.read()).toEqual({
      timezone: 'Asia/Ho_Chi_Minh',
      createdAt: AT.toISOString(),
      updatedAt: LATER.toISOString(),
    })
    expect(db.prepare('SELECT COUNT(*) AS count FROM installation_settings').get()).toEqual({ count: 1 })
  })

  it('rejects a timezone the platform cannot resolve', () => {
    expect(() => store.setTimezone('Mars/Olympus_Mons', AT)).toThrow(/timezone/i)
    expect(store.read()).toBeUndefined()
  })

  it('reads back what a previous process wrote to the same file', () => {
    store.setTimezone('Europe/Berlin', AT)
    db.close()

    const reopened = openDatabase(join(dataDir, 'simple-rss.db'))
    applyMigrations(reopened)

    expect(new InstallationSettingsStore(drizzle(reopened)).read()?.timezone).toBe('Europe/Berlin')
    reopened.close()
  })
})
