import { describe, expect, it } from 'vitest'
import { startTestService } from '../../support/service-harness.js'

const FEED = 'https://feeds.example.com/atom.xml'

describe('the service boundary', () => {
  it('retrieves through the installation-wide boundary', async () => {
    const service = await startTestService()
    service.upstream.stub(FEED, { headers: { 'content-type': 'application/atom+xml' }, body: '<feed></feed>' })

    const result = await service.retrieval.retrieveBytes({
      url: FEED,
      operation: 'feed',
      limits: { timeoutMs: 1_000 },
    })

    expect(result).toMatchObject({ ok: true, status: 200 })
    expect(service.upstream.requestsTo(FEED)).toHaveLength(1)
  })

  it('refuses a destination that points back at the installation itself', async () => {
    const service = await startTestService({ env: { PUBLIC_ORIGIN: 'https://reader.example.com' } })
    service.upstream.stub('https://reader.example.com/api/meta', { body: '{}' })

    const result = await service.retrieval.retrieveBytes({
      url: 'https://reader.example.com/api/meta',
      operation: 'reader',
      limits: { maxBytes: 1024, timeoutMs: 1_000 },
    })

    expect(result).toMatchObject({ ok: false, code: 'blocked_destination' })
    expect(service.upstream.requests).toHaveLength(0)
  })

  it('refuses a private destination even though nothing configured said so', async () => {
    const service = await startTestService()

    const result = await service.retrieval.retrieveBytes({
      url: 'http://169.254.169.254/latest/meta-data/',
      operation: 'feed',
      limits: { maxBytes: 1024, timeoutMs: 1_000 },
    })

    expect(result).toMatchObject({ ok: false, code: 'blocked_destination' })
    expect(service.upstream.requests).toHaveLength(0)
  })

  it('refuses to start with a public origin that is not a URL', async () => {
    await expect(startTestService({ env: { PUBLIC_ORIGIN: 'reader.example.com' } })).rejects.toThrow(/PUBLIC_ORIGIN/)
  })
})
