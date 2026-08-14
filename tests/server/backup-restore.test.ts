import { existsSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { runCli, type CliContext } from '../../src/server/cli.js'
import { loadConfig } from '../../src/server/config.js'
import { createLogger, type Logger } from '../../src/server/logger.js'
import { openDatabase } from '../../src/server/persistence/database.js'
import { applyMigrations, migrations } from '../../src/server/persistence/migrations.js'
import { Device, claimedDevice } from '../support/device.js'
import { ManualClock } from '../support/manual-clock.js'
import { startTestService, databasePathOf, USER_PASSWORD, type TestService } from '../support/service-harness.js'
import { makeTempDataDir } from '../support/temp-dir.js'

const RSS_URL = 'https://journal.example/feed'

const RSS = `<?xml version="1.0"?>
  <rss version="2.0"><channel><title>Field Notes</title>
    <item>
      <guid>entry-1</guid><title>Morning chronology</title><link>https://journal.example/one</link>
      <description>A morning note</description><pubDate>Fri, 07 Aug 2026 07:15:00 GMT</pubDate>
    </item>
  </channel></rss>`

function discardingLogger(): Logger {
  return createLogger({ level: 'error', sink: () => {} })
}

function cliOn(dataDir: string): { context: CliContext; output: string[] } {
  const output: string[] = []
  const context: CliContext = {
    config: loadConfig({ DATA_DIR: dataDir, PUBLIC_ORIGIN: 'https://reader.test' }),
    clock: new ManualClock('2026-08-08T09:00:00.000Z'),
    out: (line) => output.push(line),
    logger: discardingLogger(),
  }
  return { context, output }
}

describe('the backup command', () => {
  let dataDir: string
  let destination: string

  beforeEach(async () => {
    dataDir = await makeTempDataDir()
    destination = join(await makeTempDataDir(), 'snapshot.db')
  })

  it('needs a destination', async () => {
    const { context, output } = cliOn(dataDir)

    expect(await runCli(['backup'], context)).toBe(1)
    expect(output.join('\n')).toContain('destination')
  })

  it('refuses when there is no database to back up, and creates none', async () => {
    const { context, output } = cliOn(dataDir)

    expect(await runCli(['backup', destination], context)).toBe(1)

    expect(output.join('\n')).toContain('no database')
    expect(existsSync(destination)).toBe(false)
    expect(existsSync(context.config.databasePath)).toBe(false)
  })

  it('writes a snapshot holding everything the live database holds', async () => {
    const { context, output } = cliOn(dataDir)
    await runCli(['migrate'], context)
    const live = openDatabase(context.config.databasePath)
    live.exec(`
      INSERT INTO feeds (id, entered_url, resolved_url, title, domain, created_at, updated_at)
      VALUES (1, 'https://journal.example/feed', 'https://journal.example/feed', 'Field Notes',
              'journal.example', '2026-08-08T09:00:00.000Z', '2026-08-08T09:00:00.000Z');
    `)
    live.close()
    output.length = 0

    expect(await runCli(['backup', destination], context)).toBe(0)

    const report = JSON.parse(output[0]!)
    expect(report).toEqual({ backupCreated: true, destination, bytes: expect.any(Number) })
    expect(report.bytes).toBeGreaterThan(0)
    const snapshot = openDatabase(destination)
    expect(snapshot.prepare('SELECT title FROM feeds').all()).toEqual([{ title: 'Field Notes' }])
    snapshot.close()
    expect(existsSync(context.config.databasePath)).toBe(true)
  })

  it('refuses to overwrite an existing snapshot', async () => {
    const { context, output } = cliOn(dataDir)
    await runCli(['migrate'], context)
    writeFileSync(destination, 'an earlier snapshot')

    expect(await runCli(['backup', destination], context)).toBe(1)
    expect(output.join('\n')).toContain('already exists')
  })

  it('leaves nothing at the destination when the copy fails', async () => {
    const { context, output } = cliOn(dataDir)
    writeFileSync(context.config.databasePath, 'not a sqlite database')

    expect(await runCli(['backup', destination], context)).toBe(1)

    expect(output.join('\n')).toContain('failed')
    expect(existsSync(destination)).toBe(false)
    expect(existsSync(`${destination}.partial`)).toBe(false)
  })
})

describe('the restore command', () => {
  let backupDir: string
  let backupPath: string

  beforeEach(async () => {
    backupDir = await makeTempDataDir()
    backupPath = join(backupDir, 'snapshot.db')
  })

  it('needs a backup path that exists', async () => {
    const { context: missingArgument, output: first } = cliOn(await makeTempDataDir())
    expect(await runCli(['restore'], missingArgument)).toBe(1)
    expect(first.join('\n')).toContain('backup')

    const { context, output } = cliOn(await makeTempDataDir())
    expect(await runCli(['restore', backupPath], context)).toBe(1)
    expect(output.join('\n')).toContain('no backup')
    expect(existsSync(context.config.databasePath)).toBe(false)
  })

  it('refuses to restore over an existing database', async () => {
    const dataDir = await makeTempDataDir()
    const { context: seed } = cliOn(dataDir)
    await runCli(['migrate'], seed)
    await runCli(['backup', backupPath], seed)

    const { context, output } = cliOn(dataDir)
    expect(await runCli(['restore', backupPath], context)).toBe(1)
    expect(output.join('\n')).toContain('already')
  })

  it('refuses a directory holding a stray WAL sidecar, which a restored database would adopt', async () => {
    const dataDir = await makeTempDataDir()
    const { context: seed } = cliOn(dataDir)
    await runCli(['migrate'], seed)
    await runCli(['backup', backupPath], seed)

    const fresh = await makeTempDataDir()
    const { context, output } = cliOn(fresh)
    writeFileSync(`${context.config.databasePath}-wal`, 'left behind by an earlier database')

    expect(await runCli(['restore', backupPath], context)).toBe(1)

    expect(output.join('\n')).toContain('fresh data directory')
    expect(existsSync(context.config.databasePath)).toBe(false)
  })

  it('rejects a backup that is not a database, leaving the data directory uninitialized', async () => {
    writeFileSync(backupPath, 'not a sqlite database')
    const dataDir = await makeTempDataDir()
    const { context, output } = cliOn(dataDir)

    expect(await runCli(['restore', backupPath], context)).toBe(1)

    expect(output.join('\n')).toContain('failed')
    expect(readdirSync(dataDir)).toEqual([])
  })

  it('initializes a fresh data directory, migrates it, and reports what it holds', async () => {
    const dataDir = await makeTempDataDir()
    const { context: seed } = cliOn(dataDir)
    await runCli(['migrate'], seed)
    await runCli(['set-timezone', 'Europe/Berlin'], seed)
    await runCli(['backup', backupPath], seed)

    const fresh = await makeTempDataDir()
    const { context, output } = cliOn(fresh)
    expect(await runCli(['restore', backupPath], context)).toBe(0)

    expect(JSON.parse(output[0]!)).toEqual({
      restored: true,
      migrationsApplied: [],
      indexedItems: 0,
      feeds: 0,
      subscriptions: 0,
      feedItems: 0,
      libraryItems: 0,
      claimed: false,
    })
    expect(existsSync(context.config.databasePath)).toBe(true)
    expect(existsSync(`${context.config.databasePath}.restoring`)).toBe(false)

    const { context: read, output: shown } = cliOn(fresh)
    await runCli(['show'], read)
    expect(JSON.parse(shown[0]!).timezone).toBe('Europe/Berlin')
  })
})

describe('backup and restore, round-tripped through the running application', () => {
  it('preserves Subscriptions, schedules, retained Feed Items, Library membership, settings, and User access', async () => {
    const service = await startTestService()
    service.upstream.stub(RSS_URL, { headers: { 'content-type': 'application/rss+xml' }, body: RSS })
    const user = await claimedDevice(service)
    await user.put('/api/settings/timezone', { timezone: 'Europe/Berlin' })
    expect((await user.post('/api/subscriptions', { url: RSS_URL })).status).toBe(201)
    await service.wakeScheduler()

    const feeds = await (await user.get('/api/feeds')).json()
    const feedId = feeds.subscriptions[0].feedId
    await user.put(`/api/feeds/${feedId}/interval`, { pollingIntervalMinutes: 360 })
    const detail = await (await user.get(`/api/feeds/${feedId}`)).json()
    expect((await user.put(`/api/library/${detail.items[0].feedItemId}`)).status).toBe(200)
    await service.stop()

    const live = openDatabase(databasePathOf(service))
    live.exec('DELETE FROM feed_item_search')
    live.close()

    const backupPath = join(await makeTempDataDir(), 'pre-upgrade.db')
    const { context: operator } = cliOn(service.dataDir)
    expect(await runCli(['backup', backupPath], operator)).toBe(0)

    const freshDataDir = await makeTempDataDir()
    const { context: restorer, output } = cliOn(freshDataDir)
    expect(await runCli(['restore', backupPath], restorer)).toBe(0)
    expect(JSON.parse(output[0]!)).toEqual({
      restored: true,
      migrationsApplied: [],
      indexedItems: 1,
      feeds: 1,
      subscriptions: 1,
      feedItems: 1,
      libraryItems: 1,
      claimed: true,
    })

    const restored = await startTestService({ dataDir: freshDataDir })
    expect((await restored.fetch('/health/ready')).status).toBe(200)

    const device = new Device(restored)
    expect((await device.signIn(USER_PASSWORD)).status).toBe(200)

    const restoredFeeds = await (await device.get('/api/feeds')).json()
    expect(restoredFeeds.subscriptions).toHaveLength(1)
    expect(restoredFeeds.subscriptions[0].title).toBe('Field Notes')

    const restoredDetail = await (await device.get(`/api/feeds/${restoredFeeds.subscriptions[0].feedId}`)).json()
    expect(restoredDetail.schedule.pollingIntervalMinutes).toBe(360)
    expect(restoredDetail.items).toHaveLength(1)

    const library = await (await device.get('/api/library')).json()
    expect(library.items.map((item: { title: string }) => item.title)).toEqual(['Morning chronology'])

    const found = await (await device.get('/api/search?q=chronology')).json()
    expect(found.results.map((result: { title: string }) => result.title)).toEqual(['Morning chronology'])

    const settings = await (await device.get('/api/settings')).json()
    expect(settings).toEqual({ timezone: 'Europe/Berlin' })

    await restored.stop()
  })

  it('migrates a backup taken before newer schema versions forward during restore', async () => {
    const dataDir = await makeTempDataDir()
    const { context: seed } = cliOn(dataDir)
    const older = openDatabase(seed.config.databasePath)
    applyMigrations(older, seed.clock, migrations.slice(0, 3))
    older.close()
    const backupPath = join(await makeTempDataDir(), 'older-release.db')
    expect(await runCli(['backup', backupPath], seed)).toBe(0)

    const fresh = await makeTempDataDir()
    const { context, output } = cliOn(fresh)
    expect(await runCli(['restore', backupPath], context)).toBe(0)

    const report = JSON.parse(output[0]!)
    expect(report.migrationsApplied).toEqual(migrations.slice(3).map((migration) => migration.version))
  })
})
