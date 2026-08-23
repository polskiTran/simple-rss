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

  it('serves a pasted page and a Feed under preview, asking for either', async () => {
    const service = await startTestService()
    service.upstream.stub('https://blog.example.com/', {
      headers: { 'content-type': 'text/html' },
      body: '<html><head><link rel="alternate" type="application/rss+xml" href="/feed.xml"></head></html>',
    })
    service.upstream.stub('https://blog.example.com/feed.xml', {
      headers: { 'content-type': 'application/rss+xml' },
      body: '<rss></rss>',
    })

    const page = await service.retrieval.retrieveBytes({ url: 'https://blog.example.com/', operation: 'preview' })
    const feed = await service.retrieval.retrieveBytes({
      url: 'https://blog.example.com/feed.xml',
      operation: 'preview',
    })

    expect(page).toMatchObject({ ok: true, contentType: 'text/html' })
    expect(feed).toMatchObject({ ok: true, contentType: 'application/rss+xml' })
    expect(service.upstream.requestsTo('https://blog.example.com/')[0]?.headers.accept).toBe(
      'application/rss+xml, application/atom+xml, application/xml, text/xml, text/html, application/xhtml+xml',
    )
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
