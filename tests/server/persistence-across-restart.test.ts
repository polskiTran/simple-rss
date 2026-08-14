import { describe, expect, it } from 'vitest'
import { startTestService } from '../support/service-harness.js'

describe('state on the durable volume', () => {
  it('survives replacing the process, which is what a deployment does', async () => {
    const service = await startTestService()
    service.settings?.setTimezone('Europe/Berlin', service.clock.now())

    await service.restart()

    expect(service.settings?.read()?.timezone).toBe('Europe/Berlin')
  })

  it('keeps the original creation time across the replacement', async () => {
    const service = await startTestService()
    service.settings?.setTimezone('Europe/Berlin', service.clock.now())
    const before = service.settings?.read()

    await service.restart()

    expect(service.settings?.read()?.createdAt).toBe(before?.createdAt)
  })

  it('re-runs no migrations on the second start', async () => {
    const service = await startTestService()
    const beforeRestart = service.logs.length

    await service.restart()

    const applied = service.logs.slice(beforeRestart).find((record) => record.message === 'startup.migrations_applied')
    expect(applied?.applied).toEqual([])
  })

  it('comes back ready after the replacement', async () => {
    const service = await startTestService()

    await service.restart()

    expect((await service.fetch('/health/ready')).status).toBe(200)
  })

  it('starts empty on a fresh volume', async () => {
    const service = await startTestService()

    expect(service.settings?.read()).toBeUndefined()
  })
})
