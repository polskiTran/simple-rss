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
    })

    expect(result).toMatchObject({ ok: false, code: 'blocked_destination' })
    expect(service.upstream.requests).toHaveLength(0)
  })

  it('refuses 198.18.0.1 unless the dev opt-in is on outside production', async () => {
    const blocked = await startTestService()
    await expect(
      blocked.retrieval.retrieveBytes({ url: 'http://198.18.0.1/feed.xml', operation: 'feed' }),
    ).resolves.toMatchObject({ ok: false, code: 'blocked_destination', reason: 'reserved address' })

    const allowed = await startTestService({
      env: { ALLOW_RESERVED_FETCH_DESTINATIONS: 'true', NODE_ENV: 'development' },
    })
    allowed.upstream.stub('http://198.18.0.1/feed.xml', {
      headers: { 'content-type': 'application/rss+xml' },
      body: '<rss></rss>',
    })
    await expect(
      allowed.retrieval.retrieveBytes({ url: 'http://198.18.0.1/feed.xml', operation: 'feed' }),
    ).resolves.toMatchObject({ ok: true })
    expect(allowed.logs.map((record) => record.message)).not.toContain(
      'ALLOW_RESERVED_FETCH_DESTINATIONS is ignored when NODE_ENV is production',
    )

    const production = await startTestService({
      env: { ALLOW_RESERVED_FETCH_DESTINATIONS: 'true', NODE_ENV: 'production' },
    })
    await expect(
      production.retrieval.retrieveBytes({ url: 'http://198.18.0.1/feed.xml', operation: 'feed' }),
    ).resolves.toMatchObject({ ok: false, code: 'blocked_destination', reason: 'reserved address' })
    const warnings = production.logs.filter(
      (record) => record.message === 'ALLOW_RESERVED_FETCH_DESTINATIONS is ignored when NODE_ENV is production',
    )
    expect(warnings).toEqual([
      expect.objectContaining({
        level: 'warn',
        message: 'ALLOW_RESERVED_FETCH_DESTINATIONS is ignored when NODE_ENV is production',
      }),
    ])
  })

  it('still refuses other reserved destinations when the dev opt-in is on', async () => {
    const service = await startTestService({
      env: { ALLOW_RESERVED_FETCH_DESTINATIONS: 'true', NODE_ENV: 'development' },
    })

    for (const url of [
      'http://10.0.0.1/feed.xml',
      'http://127.0.0.1/feed.xml',
      'http://169.254.169.254/latest/meta-data/',
    ]) {
      await expect(service.retrieval.retrieveBytes({ url, operation: 'feed' })).resolves.toMatchObject({
        ok: false,
        code: 'blocked_destination',
      })
    }
    expect(service.upstream.requests).toHaveLength(0)
  })

  it('refuses a private destination even though nothing configured said so', async () => {
    const service = await startTestService()

    const result = await service.retrieval.retrieveBytes({
      url: 'http://169.254.169.254/latest/meta-data/',
      operation: 'feed',
    })

    expect(result).toMatchObject({ ok: false, code: 'blocked_destination' })
    expect(service.upstream.requests).toHaveLength(0)
  })

  it('refuses to reach the network for an unstubbed upstream URL', async () => {
    const service = await startTestService()

    await expect(
      service.upstream.client(new Request('https://example.com/feed.xml'), { addresses: ['93.184.216.34'] }),
    ).rejects.toThrow(/No upstream fixture/)
  })

  it('refuses to start with a public origin that is not a URL', async () => {
    await expect(startTestService({ env: { PUBLIC_ORIGIN: 'reader.example.com' } })).rejects.toThrow(/PUBLIC_ORIGIN/)
  })
})
