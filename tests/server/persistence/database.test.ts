import { existsSync } from 'node:fs'
import { chmod, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { openDatabase } from '../../../src/server/persistence/database.js'
import { makeTempDataDir } from '../../support/temp-dir.js'

describe('openDatabase', () => {
  it('creates the database file below the data directory', async () => {
    const dataDir = await makeTempDataDir()

    const db = openDatabase(join(dataDir, 'simple-rss.db'))
    db.$client.close()

    expect(existsSync(join(dataDir, 'simple-rss.db'))).toBe(true)
  })

  it('creates missing intermediate directories under the data directory', async () => {
    const dataDir = await makeTempDataDir()

    const db = openDatabase(join(dataDir, 'nested', 'simple-rss.db'))
    db.$client.close()

    expect(existsSync(join(dataDir, 'nested', 'simple-rss.db'))).toBe(true)
  })

  it('enables WAL journal mode', async () => {
    const dataDir = await makeTempDataDir()

    const db = openDatabase(join(dataDir, 'simple-rss.db'))
    const [row] = db.$client.pragma('journal_mode') as Array<{ journal_mode: string }>
    db.$client.close()

    expect(row?.journal_mode).toBe('wal')
  })

  it('configures a busy timeout so a concurrent writer waits instead of failing', async () => {
    const dataDir = await makeTempDataDir()

    const db = openDatabase(join(dataDir, 'simple-rss.db'))
    const [row] = db.$client.pragma('busy_timeout') as Array<{ timeout: number }>
    db.$client.close()

    expect(row?.timeout).toBeGreaterThanOrEqual(5000)
  })

  it('enforces foreign keys', async () => {
    const dataDir = await makeTempDataDir()

    const db = openDatabase(join(dataDir, 'simple-rss.db'))
    const [row] = db.$client.pragma('foreign_keys') as Array<{ foreign_keys: number }>
    db.$client.close()

    expect(row?.foreign_keys).toBe(1)
  })

  it('fails loudly when the data directory is not writable', async () => {
    const dataDir = await makeTempDataDir()
    const readOnly = join(dataDir, 'readonly')
    await mkdir(readOnly)
    await chmod(readOnly, 0o500)

    expect(() => openDatabase(join(readOnly, 'simple-rss.db'))).toThrow()

    await chmod(readOnly, 0o700)
  })
})
