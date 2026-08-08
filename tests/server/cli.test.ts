import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { runCli, type CliContext } from '../../src/server/cli.js'
import { loadConfig } from '../../src/server/config.js'
import { ManualClock } from '../support/manual-clock.js'
import { makeTempDataDir } from '../support/temp-dir.js'

describe('runCli', () => {
  let context: CliContext
  let output: string[]
  let dataDir: string

  beforeEach(async () => {
    dataDir = await makeTempDataDir()
    output = []
    context = {
      config: loadConfig({ DATA_DIR: dataDir }),
      clock: new ManualClock('2026-08-08T09:00:00.000Z'),
      out: (line) => output.push(line),
    }
  })

  it('migrates a fresh volume', () => {
    expect(runCli(['migrate'], context)).toBe(0)

    expect(JSON.parse(output[0]!)).toEqual({ applied: [1], versions: [1] })
  })

  it('applies nothing on a volume that is already migrated', () => {
    runCli(['migrate'], context)
    output.length = 0

    runCli(['migrate'], context)

    expect(JSON.parse(output[0]!)).toEqual({ applied: [], versions: [1] })
  })

  it('reports an unseeded installation as null rather than failing', () => {
    runCli(['migrate'], context)
    output.length = 0

    expect(runCli(['show'], context)).toBe(0)
    expect(JSON.parse(output[0]!)).toBeNull()
  })

  it('seeds the installation timezone', () => {
    expect(runCli(['set-timezone', 'Europe/Berlin'], context)).toBe(0)

    expect(JSON.parse(output[0]!)).toEqual({
      timezone: 'Europe/Berlin',
      createdAt: '2026-08-08T09:00:00.000Z',
      updatedAt: '2026-08-08T09:00:00.000Z',
    })
  })

  it('reads back a seeded timezone from the same volume', () => {
    runCli(['set-timezone', 'Europe/Berlin'], context)
    output.length = 0

    runCli(['show'], context)

    expect(JSON.parse(output[0]!).timezone).toBe('Europe/Berlin')
  })

  it('writes to the database inside the configured data directory', () => {
    runCli(['set-timezone', 'Europe/Berlin'], context)

    expect(context.config.databasePath).toBe(join(dataDir, 'simple-rss.db'))
  })

  it('rejects set-timezone without an argument', () => {
    expect(runCli(['set-timezone'], context)).toBe(1)
  })

  it('rejects a timezone the platform cannot resolve', () => {
    expect(() => runCli(['set-timezone', 'Mars/Olympus_Mons'], context)).toThrow(/timezone/i)
  })

  it('reports an unknown command with usage', () => {
    expect(runCli(['frobnicate'], context)).toBe(1)
    expect(output.join('\n')).toContain('set-timezone')
  })

  it('prints usage and fails when given no command', () => {
    expect(runCli([], context)).toBe(1)
    expect(output.join('\n')).toContain('migrate')
  })
})
