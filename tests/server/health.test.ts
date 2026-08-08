import { chmod, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { livenessSchema, readinessSchema } from '../../src/shared/api.js'
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

  it('keeps readiness closed when startup could not migrate the database', async () => {
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
      reason: 'migrations failed',
    })
    await chmod(unwritable, 0o700)
  })

  it('logs a failed startup with the reason instead of exiting silently', async () => {
    const parent = await makeTempDataDir()
    const unwritable = join(parent, 'readonly')
    await mkdir(unwritable)
    await chmod(unwritable, 0o500)

    const service = await startTestService({ dataDir: join(unwritable, 'data') })

    expect(service.logs.map((record) => record.message)).toContain('startup.migrations_failed')
    await chmod(unwritable, 0o700)
  })

  it('does not answer health checks with the client bundle', async () => {
    const service = await startTestService()

    const response = await service.fetch('/health/ready')

    expect(response.headers.get('content-type')).toMatch(/application\/json/)
  })
})
