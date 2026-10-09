import { existsSync } from 'node:fs'
import { chmod, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'
import { livenessSchema, readinessSchema } from '../../src/shared/api.js'
import { DATABASE_FILE } from '../../src/server/config.js'
import { startTestService } from '../support/service-harness.js'
import { makeTempDataDir } from '../support/temp-dir.js'

describe('health endpoints', () => {
  it('reports liveness as soon as the process answers', async () => {
    const service = await startTestService()

    const response = await service.fetch('/health/live')

    expect(response.status).toBe(200)
    expect(livenessSchema.parse(await response.json())).toEqual({ status: 'live' })
  })

  it('reports readiness once migrations have completed and the volume accepts writes', async () => {
    const service = await startTestService()

    const response = await service.fetch('/health/ready')

    expect(response.status).toBe(200)
    expect(readinessSchema.parse(await response.json())).toEqual({ status: 'ready' })
  })

  it('keeps readiness closed with the step that failed when the database cannot be opened', async () => {
    const parent = await makeTempDataDir()
    const unwritable = join(parent, 'readonly')
    await mkdir(unwritable)
    await chmod(unwritable, 0o500)

    const service = await startTestService({ dataDir: join(unwritable, 'data') })

    const live = await service.fetch('/health/live')
    const ready = await service.fetch('/health/ready')

    expect(live.status).toBe(200)
    expect(ready.status).toBe(503)
    expect(readinessSchema.parse(await ready.json())).toEqual({
      status: 'unready',
      reason: 'database could not be opened',
    })
    await chmod(unwritable, 0o700)
  })

  it('keeps readiness closed and lets go of the database when migrations fail', async () => {
    const dataDir = await makeTempDataDir()
    const databasePath = join(dataDir, DATABASE_FILE)
    const squatter = new Database(databasePath)
    squatter.exec('CREATE TABLE installation_settings (squatter TEXT)')
    squatter.close()

    const service = await startTestService({ dataDir })
    const ready = await service.fetch('/health/ready')

    expect(readinessSchema.parse(await ready.json())).toEqual({ status: 'unready', reason: 'migrations failed' })
    // SQLite removes the WAL when its last connection closes.
    expect(existsSync(`${databasePath}-wal`)).toBe(false)
  })

  it('refuses API requests when startup failed', async () => {
    const parent = await makeTempDataDir()
    const unwritable = join(parent, 'readonly')
    await mkdir(unwritable)
    await chmod(unwritable, 0o500)

    const service = await startTestService({ dataDir: join(unwritable, 'data') })

    const response = await service.fetch('/api/feeds')

    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ error: { code: 'unavailable', message: 'Service is not ready' } })
    await chmod(unwritable, 0o700)
  })

  it('logs a failed startup with the error that stopped it instead of exiting silently', async () => {
    const parent = await makeTempDataDir()
    const unwritable = join(parent, 'readonly')
    await mkdir(unwritable)
    await chmod(unwritable, 0o500)

    const service = await startTestService({ dataDir: join(unwritable, 'data') })

    expect(service.logs.find((record) => record.message === 'startup.failed')).toMatchObject({
      reason: 'database could not be opened',
      error: { message: expect.stringContaining('EACCES') },
    })
    await chmod(unwritable, 0o700)
  })

  it('does not answer health checks with the client bundle', async () => {
    const service = await startTestService()

    const response = await service.fetch('/health/ready')

    expect(response.headers.get('content-type')).toMatch(/application\/json/)
  })

  it('returns JSON 404 for an unknown health route instead of the client shell', async () => {
    const service = await startTestService({ clientDir: 'tests/fixtures/client' })

    const response = await service.fetch('/health/unknown')

    expect(response.status).toBe(404)
    expect(response.headers.get('content-type')).toMatch(/application\/json/)
    expect(await response.json()).toEqual({
      error: { code: 'not_found', message: 'Unknown health route' },
    })
  })
})
