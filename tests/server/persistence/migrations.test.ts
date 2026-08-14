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

  it('creates the user_auth singleton table', async () => {
    const db = await openFreshDatabase()
    applyMigrations(db)

    const columns = (db.pragma('table_info(user_auth)') as Array<{ name: string }>).map((column) => column.name)

    expect(columns).toEqual(expect.arrayContaining(['id', 'password_hash', 'claimed_at', 'updated_at']))
    db.close()
  })

  it('makes a second User unrepresentable rather than merely refused', async () => {
    const db = await openFreshDatabase()
    applyMigrations(db)
    const insert = db.prepare('INSERT INTO user_auth (id, password_hash, claimed_at, updated_at) VALUES (?, ?, ?, ?)')

    insert.run(1, '$argon2id$first', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')

    expect(() => insert.run(2, '$argon2id$second', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')).toThrow()
    db.close()
  })

  it('leaves a Feed recorded before the home page column ready to fill it in on the next poll', async () => {
    const db = await openFreshDatabase()
    applyMigrations(
      db,
      systemClock,
      migrations.filter((migration) => migration.version < 8),
    )
    db.prepare(
      `INSERT INTO feeds (entered_url, resolved_url, title, domain, etag, last_modified, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      'https://journal.example/feed',
      'https://journal.example/feed',
      'Field Notes',
      'journal.example',
      '"v1"',
      'Fri, 08 Aug 2026 07:00:00 GMT',
      '2026-01-01T00:00:00.000Z',
      '2026-01-01T00:00:00.000Z',
    )

    const applied = applyMigrations(db)

    expect(applied).toEqual([8, 9])
    expect(db.prepare('SELECT domain, home_page_url, etag, last_modified FROM feeds').get()).toEqual({
      domain: 'journal.example',
      home_page_url: null,
      etag: null,
      last_modified: null,
    })
    db.close()
  })

  it('carries an already-claimed volume through the rename to user_auth', async () => {
    const db = await openFreshDatabase()
    applyMigrations(
      db,
      systemClock,
      migrations.filter((migration) => migration.version < 7),
    )
    db.prepare('INSERT INTO owner_auth (id, password_hash, claimed_at, updated_at) VALUES (?, ?, ?, ?)').run(
      1,
      '$argon2id$claimed-before-the-rename',
      '2026-01-01T00:00:00.000Z',
      '2026-01-01T00:00:00.000Z',
    )

    const applied = applyMigrations(
      db,
      systemClock,
      migrations.filter((migration) => migration.version <= 7),
    )

    expect(applied).toEqual([7])
    const row = db.prepare('SELECT password_hash, claimed_at FROM user_auth').get() as {
      password_hash: string
      claimed_at: string
    }
    expect(row.password_hash).toBe('$argon2id$claimed-before-the-rename')
    expect(row.claimed_at).toBe('2026-01-01T00:00:00.000Z')
    expect(db.pragma('table_list(owner_auth)')).toEqual([])
    db.close()
  })

  it('creates the sessions table with an index the expiry sweep can use', async () => {
    const db = await openFreshDatabase()
    applyMigrations(db)

    const columns = (db.pragma('table_info(sessions)') as Array<{ name: string }>).map((column) => column.name)
    const indexes = (db.pragma('index_list(sessions)') as Array<{ name: string }>).map((index) => index.name)

    expect(columns).toEqual(['token_hash', 'created_at', 'last_seen_at', 'expires_at'])
    expect(indexes).toContain('sessions_expires_at')
    db.close()
  })
})
