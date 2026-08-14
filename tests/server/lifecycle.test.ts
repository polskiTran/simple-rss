import { existsSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { readinessSchema } from '../../src/shared/api.js'
import { databasePathOf, startTestService } from '../support/service-harness.js'

describe('service lifecycle', () => {
  it('creates the database inside the configured data directory', async () => {
    const service = await startTestService()

    expect(existsSync(databasePathOf(service))).toBe(true)
    expect(service.config.databasePath).toBe(databasePathOf(service))
  })

  it('refuses connections once stopped', async () => {
    const service = await startTestService()
    const url = service.url

    await service.stop()

    await expect(fetch(`${url}/health/live`)).rejects.toThrow()
  })

  it('closes the database as part of stopping', async () => {
    const service = await startTestService()
    const db = service.database!

    await service.stop()

    expect(db.open).toBe(false)
  })

  it('logs the shutdown sequence in order', async () => {
    const service = await startTestService()

    await service.stop()

    const lifecycle = service.logs
      .map((record) => record.message)
      .filter(
        (message) => message === 'server.started' || message === 'server.stopping' || message === 'server.stopped',
      )
    expect(lifecycle).toEqual(['server.started', 'server.stopping', 'server.stopped'])
  })

  it('treats a second stop as a no-op rather than an error', async () => {
    const service = await startTestService()

    await service.stop()

    await expect(service.stop()).resolves.toBeUndefined()
  })

  it('drains an established keep-alive connection instead of waiting out the grace period', async () => {
    const service = await startTestService({ env: { SHUTDOWN_GRACE_MS: '30000' } })
    await (await service.fetch('/api/meta')).text()

    const startedAt = Date.now()
    await service.stop()

    expect(Date.now() - startedAt).toBeLessThan(2_000)
    expect(service.logs.map((record) => record.message)).not.toContain('server.stop_forced')
  })

  it('closes readiness when the volume stops accepting writes', async () => {
    const service = await startTestService()
    service.database!.exec('DROP TABLE write_probe')

    const response = await service.fetch('/health/ready')

    expect(response.status).toBe(503)
    expect(readinessSchema.parse(await response.json())).toEqual({
      status: 'unready',
      reason: 'database is not writable',
    })
  })
})
