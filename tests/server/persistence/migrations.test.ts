import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { systemClock } from '../../../src/server/clock.js'
import { openDatabase } from '../../../src/server/persistence/database.js'
import { applyMigrations, appliedVersions, migrations } from '../../../src/server/persistence/migrations.js'
import { ManualClock } from '../../support/manual-clock.js'
import { makeTempDataDir } from '../../support/temp-dir.js'

async function openFreshDatabase() {
  const dataDir = await makeTempDataDir()
  return openDatabase(join(dataDir, 'simple-rss.db'))
}

describe('migrations', () => {
  it('declares strictly increasing, unique versions starting at 1', () => {
    const versions = migrations.map((migration) => migration.version)

    expect(versions).toEqual(versions.map((_, index) => index + 1))
  })

  it('applies every declared migration to a fresh database', async () => {
    const db = await openFreshDatabase()

    const applied = applyMigrations(db)

    expect(applied).toEqual(migrations.map((migration) => migration.version))
    expect(appliedVersions(db)).toEqual(migrations.map((migration) => migration.version))
    db.close()
  })

  it('is a no-op on an already migrated database', async () => {
    const db = await openFreshDatabase()
    applyMigrations(db)

    const applied = applyMigrations(db)

    expect(applied).toEqual([])
    db.close()
  })

  it('survives a reopen of the same file, which is what container replacement does', async () => {
    const dataDir = await makeTempDataDir()
    const path = join(dataDir, 'simple-rss.db')
    const first = openDatabase(path)
    applyMigrations(first)
    first.close()

    const second = openDatabase(path)
    const applied = applyMigrations(second)

    expect(applied).toEqual([])
    expect(appliedVersions(second)).toEqual(migrations.map((migration) => migration.version))
    second.close()
  })

  it('records when each migration was applied, from the injected clock', async () => {
    const db = await openFreshDatabase()
    applyMigrations(db, new ManualClock('2026-08-08T09:00:00.000Z'))

    const rows = db
      .prepare('SELECT version, name, applied_at FROM schema_migrations ORDER BY version')
      .all() as Array<{ version: number; name: string; applied_at: string }>

    expect(rows).toHaveLength(migrations.length)
    for (const row of rows) {
      expect(row.name).not.toBe('')
      expect(row.applied_at).toBe('2026-08-08T09:00:00.000Z')
    }
    db.close()
  })

  it('rolls the whole migration back when its statements fail', async () => {
    const db = await openFreshDatabase()

    expect(() =>
      applyMigrations(db, systemClock, [
        { version: 1, name: 'creates-then-fails', sql: 'CREATE TABLE half_done (id INTEGER); SELECT bad_function();' },
      ]),
    ).toThrow()

    const table = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'half_done'")
      .get()
    expect(table).toBeUndefined()
    expect(appliedVersions(db)).toEqual([])
    db.close()
  })

  it('creates the installation_settings singleton table', async () => {
    const db = await openFreshDatabase()
    applyMigrations(db)

    const columns = (db.pragma('table_info(installation_settings)') as Array<{ name: string }>).map(
      (column) => column.name,
    )

    expect(columns).toEqual(expect.arrayContaining(['id', 'timezone', 'created_at', 'updated_at']))
    db.close()
  })

  it('refuses a second installation_settings row', async () => {
    const db = await openFreshDatabase()
    applyMigrations(db)

    expect(() =>
      db
        .prepare('INSERT INTO installation_settings (id, timezone, created_at, updated_at) VALUES (?, ?, ?, ?)')
        .run(2, 'UTC', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
    ).toThrow()
    db.close()
  })
})
