import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { UserAuthStore } from '../../src/server/auth/user-auth.js'
import { argon2idHasher } from '../../src/server/auth/password.js'
import { SessionStore } from '../../src/server/auth/sessions.js'
import { runCli, NEW_PASSWORD_VARIABLE, type CliContext } from '../../src/server/cli.js'
import { loadConfig } from '../../src/server/config.js'
import { createLogger, type Logger } from '../../src/server/logger.js'
import { openDatabase } from '../../src/server/persistence/database.js'
import { appliedVersions, applyMigrations, migrations } from '../../src/server/persistence/migrations.js'
import { ManualClock } from '../support/manual-clock.js'
import { makeTempDataDir } from '../support/temp-dir.js'

const ALL_VERSIONS = migrations.map((migration) => migration.version)

function discardingLogger(): Logger {
  return createLogger({ level: 'error', sink: () => {} })
}

describe('runCli', () => {
  let context: CliContext
  let output: string[]
  let dataDir: string

  beforeEach(async () => {
    dataDir = await makeTempDataDir()
    output = []
    context = {
      config: loadConfig({ DATA_DIR: dataDir, PUBLIC_ORIGIN: 'https://reader.test' }),
      clock: new ManualClock('2026-08-08T09:00:00.000Z'),
      out: (line) => output.push(line),
      logger: discardingLogger(),
    }
  })

  it('migrates a fresh volume', async () => {
    expect(await runCli(['migrate'], context)).toBe(0)

    expect(JSON.parse(output[0]!)).toEqual({ applied: ALL_VERSIONS, versions: ALL_VERSIONS })
  })

  it('applies nothing on a volume that is already migrated', async () => {
    await runCli(['migrate'], context)
    output.length = 0

    await runCli(['migrate'], context)

    expect(JSON.parse(output[0]!)).toEqual({ applied: [], versions: ALL_VERSIONS })
  })

  it('reports an unseeded installation as null rather than failing', async () => {
    await runCli(['migrate'], context)
    output.length = 0

    expect(await runCli(['show'], context)).toBe(0)
    expect(JSON.parse(output[0]!)).toBeNull()
  })

  it('seeds the installation timezone', async () => {
    expect(await runCli(['set-timezone', 'Europe/Berlin'], context)).toBe(0)

    expect(JSON.parse(output[0]!)).toEqual({
      timezone: 'Europe/Berlin',
      createdAt: '2026-08-08T09:00:00.000Z',
      updatedAt: '2026-08-08T09:00:00.000Z',
    })
  })

  it('reads back a seeded timezone from the same volume', async () => {
    await runCli(['set-timezone', 'Europe/Berlin'], context)
    output.length = 0

    await runCli(['show'], context)

    expect(JSON.parse(output[0]!).timezone).toBe('Europe/Berlin')
  })

  it('rebuilds the search index from the canonical tables', async () => {
    await runCli(['migrate'], context)
    const db = openDatabase(context.config.databasePath)
    db.$client.exec(`
      INSERT INTO feeds (id, entered_url, resolved_url, title, domain, created_at, updated_at)
      VALUES (1, 'https://journal.example/feed', 'https://journal.example/feed', 'Field Notes',
              'journal.example', '2026-08-08T09:00:00.000Z', '2026-08-08T09:00:00.000Z');
      INSERT INTO feed_items (id, feed_id, dedupe_key, identity_kind, title, first_seen_at, last_observed_at)
      VALUES (1, 1, 'a', 'guid', 'Morning chronology', '2026-08-08T09:00:00.000Z', '2026-08-08T09:00:00.000Z');
      -- The derived index is lost; the canonical rows are not.
      DELETE FROM feed_item_search;
    `)
    db.$client.close()
    output.length = 0

    expect(await runCli(['rebuild-search'], context)).toBe(0)
    expect(JSON.parse(output[0]!)).toEqual({ searchIndexRebuilt: true, indexedItems: 1 })
  })

  it('writes to the database inside the configured data directory', async () => {
    await runCli(['set-timezone', 'Europe/Berlin'], context)

    expect(context.config.databasePath).toBe(join(dataDir, 'simple-rss.db'))
  })

  it('rejects set-timezone without an argument', async () => {
    expect(await runCli(['set-timezone'], context)).toBe(1)
  })

  it('rejects a timezone the platform cannot resolve', async () => {
    await expect(runCli(['set-timezone', 'Mars/Olympus_Mons'], context)).rejects.toThrow(/timezone/i)
  })

  it('reports an unknown command with usage', async () => {
    expect(await runCli(['frobnicate'], context)).toBe(1)
    expect(output.join('\n')).toContain('set-timezone')
  })

  it('prints usage and fails when given no command', async () => {
    expect(await runCli([], context)).toBe(1)
    expect(output.join('\n')).toContain('migrate')
  })
})

describe('runCli reset-password', () => {
  let context: CliContext
  let output: string[]
  let dataDir: string

  function inspect<T>(read: (stores: { user: UserAuthStore; sessions: SessionStore }) => T): T {
    const db = openDatabase(join(dataDir, 'simple-rss.db'))
    try {
      applyMigrations(db)
      return read({ user: new UserAuthStore(db), sessions: new SessionStore(db) })
    } finally {
      db.$client.close()
    }
  }

  beforeEach(async () => {
    dataDir = await makeTempDataDir()
    output = []
    context = {
      config: loadConfig({ DATA_DIR: dataDir, PUBLIC_ORIGIN: 'https://reader.test' }),
      clock: new ManualClock('2026-08-08T09:00:00.000Z'),
      out: (line) => output.push(line),
      logger: discardingLogger(),
    }
  })

  it('installs a verifier that accepts the new password', async () => {
    expect(await runCli(['reset-password', 'a-recovered-password'], context)).toBe(0)

    const record = inspect(({ user }) => user.read())
    expect(await argon2idHasher().verify(record!.passwordHash, 'a-recovered-password')).toBe(true)
  })

  it('claims an installation whose setup secret was never used', async () => {
    await runCli(['reset-password', 'a-recovered-password'], context)

    expect(inspect(({ user }) => user.isClaimed())).toBe(true)
  })

  it('revokes every session, and says how many it ended', async () => {
    const at = context.clock.now()
    const issued = inspect(({ user, sessions }) => {
      user.resetPassword('an-existing-verifier', at)
      return [
        sessions.issueForPasswordHash('an-existing-verifier', at),
        sessions.issueForPasswordHash('an-existing-verifier', at),
      ]
    })

    await runCli(['reset-password', 'a-recovered-password'], context)

    expect(JSON.parse(output[0]!)).toEqual({ passwordReset: true, sessionsRevoked: 2 })
    expect(inspect(({ sessions }) => sessions.touch(issued[0]!.token, at))).toBe(false)
    expect(inspect(({ sessions }) => sessions.touch(issued[1]!.token, at))).toBe(false)
  })

  it('replaces a password the User has forgotten, without being told it', async () => {
    await runCli(['reset-password', 'the-original-password'], context)
    output.length = 0

    await runCli(['reset-password', 'the-recovered-password'], context)

    const record = inspect(({ user }) => user.read())
    expect(await argon2idHasher().verify(record!.passwordHash, 'the-recovered-password')).toBe(true)
    expect(await argon2idHasher().verify(record!.passwordHash, 'the-original-password')).toBe(false)
  })

  it('takes the password from the environment, to keep it out of shell history', async () => {
    const withEnv: CliContext = { ...context, env: { [NEW_PASSWORD_VARIABLE]: 'a-recovered-password' } }

    expect(await runCli(['reset-password'], withEnv)).toBe(0)

    const record = inspect(({ user }) => user.read())
    expect(await argon2idHasher().verify(record!.passwordHash, 'a-recovered-password')).toBe(true)
  })

  it('prefers the argument over the environment when both are given', async () => {
    const withEnv: CliContext = { ...context, env: { [NEW_PASSWORD_VARIABLE]: 'the-environment-one' } }

    await runCli(['reset-password', 'the-argument-one'], withEnv)

    const record = inspect(({ user }) => user.read())
    expect(await argon2idHasher().verify(record!.passwordHash, 'the-argument-one')).toBe(true)
  })

  it('does not migrate an older database before validating the password', async () => {
    const older = openDatabase(context.config.databasePath)
    try {
      applyMigrations(older, context.clock, migrations.slice(0, 3))
    } finally {
      older.$client.close()
    }

    expect(await runCli(['reset-password', 'short'], context)).toBe(1)

    const inspected = openDatabase(context.config.databasePath)
    try {
      expect(appliedVersions(inspected)).toEqual([1, 2, 3])
    } finally {
      inspected.$client.close()
    }
  })

  it('explains itself rather than resetting to nothing', async () => {
    expect(await runCli(['reset-password'], context)).toBe(1)

    expect(output.join('\n')).toContain(NEW_PASSWORD_VARIABLE)
    expect(inspect(({ user }) => user.isClaimed())).toBe(false)
  })

  it('holds a recovered password to the same length rule as a chosen one', async () => {
    expect(await runCli(['reset-password', 'short'], context)).toBe(1)

    expect(output.join('\n')).toMatch(/at least 12 characters/)
    expect(inspect(({ user }) => user.isClaimed())).toBe(false)
  })

  it('rejects a multibyte password beyond the hashing byte limit', async () => {
    expect(await runCli(['reset-password', '界'.repeat(400)], context)).toBe(1)

    expect(inspect(({ user }) => user.isClaimed())).toBe(false)
  })

  it('is listed in the usage an operator sees', async () => {
    await runCli([], context)

    expect(output.join('\n')).toContain('reset-password')
  })
})
