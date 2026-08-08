import { describe, expect, it } from 'vitest'
import { createLogger, type LogRecord } from '../../../src/server/logger.js'
import type { ResolveAddresses } from '../../../src/server/upstream/destination.js'
import {
  createRetrieval,
  MAX_BYTES,
  type Retrieval,
  type RetrievalRequest,
} from '../../../src/server/upstream/retrieval.js'
import { chunkedBody, UpstreamFixtures } from '../../support/upstream-fixtures.js'

interface Harness {
  readonly retrieval: Retrieval
  readonly upstream: UpstreamFixtures
  readonly logs: readonly LogRecord[]
}

interface HarnessOptions {
  readonly addresses?: Record<string, readonly string[]>
  readonly resolve?: ResolveAddresses
  readonly self?: readonly string[]
  readonly maxConcurrent?: number
  readonly maxQueued?: number
}

function harness(options: HarnessOptions = {}): Harness {
  const upstream = new UpstreamFixtures()
  const logs: LogRecord[] = []
  const addresses = options.addresses ?? { 'example.com': ['93.184.216.34'] }

  const retrieval = createRetrieval({
    httpClient: upstream.client,
    logger: createLogger({ level: 'debug', sink: (record) => logs.push(record) }),
    resolve: options.resolve ?? (async (hostname) => addresses[hostname] ?? []),
    ...(options.self ? { self: options.self } : {}),
    ...(options.maxConcurrent === undefined ? {} : { maxConcurrent: options.maxConcurrent }),
    ...(options.maxQueued === undefined ? {} : { maxQueued: options.maxQueued }),
  })

  return { retrieval, upstream, logs }
}

/** A Feed-shaped retrieval, which every test varies rather than restates. */
function feedRequest(url: string, overrides: Partial<RetrievalRequest> = {}): RetrievalRequest {
  return {
    url,
    operation: 'feed',
    accept: ['application/rss+xml', 'application/xml', 'text/xml'],
    maxBytes: 2 * 1024 * 1024,
    timeoutMs: 1_000,
    ...overrides,
  }
}

function decode(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes)
}

describe('retrieveBytes', () => {
  it('returns the body of an allowed destination with what it came from', async () => {
    const { retrieval, upstream } = harness()
    upstream.stub('https://example.com/feed.xml', {
      headers: { 'content-type': 'application/rss+xml; charset=utf-8', etag: '"v1"' },
      body: '<rss></rss>',
    })

    const result = await retrieval.retrieveBytes(feedRequest('https://example.com/feed.xml'))

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(decode(result.bytes)).toBe('<rss></rss>')
    expect(result.status).toBe(200)
    expect(result.url).toBe('https://example.com/feed.xml')
    expect(result.contentType).toBe('application/rss+xml')
    expect(result.etag).toBe('"v1"')
  })

  it('sends only the headers the caller is allowed to set', async () => {
    const { retrieval, upstream } = harness()
    upstream.stub('https://example.com/feed.xml', {
      headers: { 'content-type': 'application/xml' },
      body: '<rss></rss>',
    })

    await retrieval.retrieveBytes(
      feedRequest('https://example.com/feed.xml', {
        headers: {
          'if-none-match': '"v1"',
          cookie: 'session=owner-token',
          authorization: 'Bearer owner-token',
          'x-setup-secret': 'the-setup-secret',
          referer: 'https://reader.example.com/digest',
        },
      }),
    )

    const [sent] = upstream.requestsTo('https://example.com/feed.xml')
    expect(sent?.headers['if-none-match']).toBe('"v1"')
    expect(sent?.headers['user-agent']).toMatch(/simple-rss/)
    expect(sent?.headers).not.toHaveProperty('cookie')
    expect(sent?.headers).not.toHaveProperty('authorization')
    expect(sent?.headers).not.toHaveProperty('x-setup-secret')
    expect(sent?.headers).not.toHaveProperty('referer')
  })

  it('refuses a private destination before connecting', async () => {
    const { retrieval, upstream } = harness({ addresses: { 'intranet.example.com': ['10.1.2.3'] } })

    const result = await retrieval.retrieveBytes(feedRequest('https://intranet.example.com/feed.xml'))

    expect(result).toMatchObject({ ok: false, code: 'blocked_destination' })
    expect(upstream.requests).toHaveLength(0)
  })

  it('re-resolves on every retrieval, so a name that turns private stops working', async () => {
    let answers: readonly string[] = ['93.184.216.34']
    const { retrieval, upstream } = harness({ resolve: async () => answers })
    upstream.stub('https://example.com/feed.xml', {
      headers: { 'content-type': 'application/xml' },
      body: '<rss></rss>',
    })

    await expect(retrieval.retrieveBytes(feedRequest('https://example.com/feed.xml'))).resolves.toMatchObject({
      ok: true,
    })

    answers = ['127.0.0.1']
    await expect(retrieval.retrieveBytes(feedRequest('https://example.com/feed.xml'))).resolves.toMatchObject({
      ok: false,
      code: 'blocked_destination',
    })
    expect(upstream.requests).toHaveLength(1)
  })

  it('refuses a malformed URL', async () => {
    const { retrieval } = harness()

    await expect(retrieval.retrieveBytes(feedRequest('not-a-url'))).resolves.toMatchObject({
      ok: false,
      code: 'invalid_url',
    })
  })

  it('refuses a body whose type is not one the caller asked for', async () => {
    const { retrieval, upstream } = harness()
    upstream.stub('https://example.com/feed.xml', {
      headers: { 'content-type': 'text/html; charset=utf-8' },
      body: '<html></html>',
    })

    await expect(retrieval.retrieveBytes(feedRequest('https://example.com/feed.xml'))).resolves.toMatchObject({
      ok: false,
      code: 'unsupported_content_type',
    })
  })

  it('refuses a body that declares no type at all', async () => {
    const { retrieval, upstream } = harness()
    upstream.stub('https://example.com/feed.xml', { body: '<rss></rss>' })

    await expect(retrieval.retrieveBytes(feedRequest('https://example.com/feed.xml'))).resolves.toMatchObject({
      ok: false,
      code: 'unsupported_content_type',
    })
  })

  it('refuses a declared length beyond the ceiling without reading the body', async () => {
    const { retrieval, upstream } = harness()
    upstream.stub('https://example.com/feed.xml', {
      headers: { 'content-type': 'application/xml', 'content-length': '5000' },
      body: 'x'.repeat(5000),
    })

    await expect(
      retrieval.retrieveBytes(feedRequest('https://example.com/feed.xml', { maxBytes: 1000 })),
    ).resolves.toMatchObject({ ok: false, code: 'too_large' })
    expect(upstream.aborted).toContain('https://example.com/feed.xml')
  })

  it('stops a body that passes the ceiling while streaming, with no length declared', async () => {
    const { retrieval, upstream } = harness()
    const chunk = new Uint8Array(256)
    upstream.stubDynamic('https://example.com/feed.xml', () => ({
      headers: { 'content-type': 'application/xml' },
      body: chunkedBody([chunk, chunk, chunk, chunk, chunk, chunk]),
    }))

    await expect(
      retrieval.retrieveBytes(feedRequest('https://example.com/feed.xml', { maxBytes: 1000 })),
    ).resolves.toMatchObject({ ok: false, code: 'too_large' })
  })

  it('stops a body that lied about its length', async () => {
    const { retrieval, upstream } = harness()
    const chunk = new Uint8Array(256)
    upstream.stubDynamic('https://example.com/feed.xml', () => ({
      headers: { 'content-type': 'application/xml', 'content-length': '10' },
      body: chunkedBody([chunk, chunk, chunk, chunk, chunk, chunk]),
    }))

    await expect(
      retrieval.retrieveBytes(feedRequest('https://example.com/feed.xml', { maxBytes: 1000 })),
    ).resolves.toMatchObject({ ok: false, code: 'too_large' })
  })

  it('accepts a body exactly at the ceiling', async () => {
    const { retrieval, upstream } = harness()
    upstream.stub('https://example.com/feed.xml', {
      headers: { 'content-type': 'application/xml' },
      body: 'x'.repeat(1000),
    })

    const result = await retrieval.retrieveBytes(feedRequest('https://example.com/feed.xml', { maxBytes: 1000 }))

    expect(result.ok).toBe(true)
    expect(result.ok && result.bytes.byteLength).toBe(1000)
  })

  it('holds a caller to the boundary ceiling, however much it asked for', async () => {
    const { retrieval, upstream } = harness()
    upstream.stub('https://example.com/feed.xml', {
      headers: { 'content-type': 'application/xml', 'content-length': String(MAX_BYTES + 1) },
      body: '<rss></rss>',
    })

    await expect(
      retrieval.retrieveBytes(feedRequest('https://example.com/feed.xml', { maxBytes: 512 * 1024 * 1024 })),
    ).resolves.toMatchObject({ ok: false, code: 'too_large' })
  })

  it('reports an upstream error status without treating it as a body', async () => {
    const { retrieval, upstream } = harness()
    upstream.stub('https://example.com/feed.xml', { status: 503, body: 'try later' })

    await expect(retrieval.retrieveBytes(feedRequest('https://example.com/feed.xml'))).resolves.toMatchObject({
      ok: false,
      code: 'http_error',
      status: 503,
    })
  })

  it('reports a refused connection as unavailable rather than as a policy decision', async () => {
    const retrieval = createRetrieval({
      httpClient: async () => {
        throw new Error('connect ECONNREFUSED')
      },
      logger: createLogger({ level: 'error', sink: () => {} }),
      resolve: async () => ['93.184.216.34'],
    })

    await expect(retrieval.retrieveBytes(feedRequest('https://example.com/feed.xml'))).resolves.toMatchObject({
      ok: false,
      code: 'unavailable',
    })
  })

  it('answers a conditional request that was not modified with no body', async () => {
    const { retrieval, upstream } = harness()
    upstream.stub('https://example.com/feed.xml', { status: 304, headers: { etag: '"v1"' } })

    const result = await retrieval.retrieveBytes(
      feedRequest('https://example.com/feed.xml', { headers: { 'if-none-match': '"v1"' } }),
    )

    expect(result).toMatchObject({ ok: true, status: 304, notModified: true, etag: '"v1"' })
    expect(result.ok && result.bytes.byteLength).toBe(0)
  })
})

describe('redirects', () => {
  it('follows a redirect and reports where the bytes came from', async () => {
    const { retrieval, upstream } = harness({
      addresses: { 'example.com': ['93.184.216.34'], 'cdn.example.net': ['93.184.216.35'] },
    })
    upstream.stub('https://example.com/feed', { status: 301, headers: { location: 'https://cdn.example.net/feed.xml' } })
    upstream.stub('https://cdn.example.net/feed.xml', {
      headers: { 'content-type': 'application/xml' },
      body: '<rss></rss>',
    })

    const result = await retrieval.retrieveBytes(feedRequest('https://example.com/feed'))

    expect(result).toMatchObject({ ok: true, url: 'https://cdn.example.net/feed.xml' })
  })

  it('resolves a relative location against the hop it came from', async () => {
    const { retrieval, upstream } = harness()
    upstream.stub('https://example.com/feed', { status: 302, headers: { location: '/feeds/main.xml' } })
    upstream.stub('https://example.com/feeds/main.xml', {
      headers: { 'content-type': 'application/xml' },
      body: '<rss></rss>',
    })

    await expect(retrieval.retrieveBytes(feedRequest('https://example.com/feed'))).resolves.toMatchObject({
      ok: true,
      url: 'https://example.com/feeds/main.xml',
    })
  })

  it('validates each hop independently, so a public host cannot redirect inward', async () => {
    const { retrieval, upstream } = harness({
      addresses: { 'example.com': ['93.184.216.34'], 'intranet.example.com': ['10.1.2.3'] },
    })
    upstream.stub('https://example.com/feed', {
      status: 302,
      headers: { location: 'https://intranet.example.com/secrets' },
    })

    await expect(retrieval.retrieveBytes(feedRequest('https://example.com/feed'))).resolves.toMatchObject({
      ok: false,
      code: 'blocked_destination',
    })
    expect(upstream.requests).toHaveLength(1)
  })

  it('refuses a redirect that leaves HTTP entirely', async () => {
    const { retrieval, upstream } = harness()
    upstream.stub('https://example.com/feed', { status: 302, headers: { location: 'file:///etc/passwd' } })

    await expect(retrieval.retrieveBytes(feedRequest('https://example.com/feed'))).resolves.toMatchObject({
      ok: false,
      code: 'blocked_destination',
    })
  })

  it('stops after five redirects', async () => {
    const { retrieval, upstream } = harness()
    for (let hop = 0; hop <= 8; hop += 1) {
      upstream.stub(`https://example.com/hop/${hop}`, {
        status: 302,
        headers: { location: `https://example.com/hop/${hop + 1}` },
      })
    }

    await expect(retrieval.retrieveBytes(feedRequest('https://example.com/hop/0'))).resolves.toMatchObject({
      ok: false,
      code: 'too_many_redirects',
    })
    expect(upstream.requests).toHaveLength(6)
  })

  it('honours a caller that will follow fewer hops', async () => {
    const { retrieval, upstream } = harness()
    upstream.stub('https://example.com/feed', { status: 301, headers: { location: 'https://example.com/other' } })
    upstream.stub('https://example.com/other', {
      headers: { 'content-type': 'application/xml' },
      body: '<rss></rss>',
    })

    await expect(
      retrieval.retrieveBytes(feedRequest('https://example.com/feed', { maxRedirects: 0 })),
    ).resolves.toMatchObject({ ok: false, code: 'too_many_redirects' })
  })

  it('breaks a redirect loop instead of walking it to the limit', async () => {
    const { retrieval, upstream } = harness()
    upstream.stub('https://example.com/a', { status: 302, headers: { location: 'https://example.com/b' } })
    upstream.stub('https://example.com/b', { status: 302, headers: { location: 'https://example.com/a' } })

    await expect(retrieval.retrieveBytes(feedRequest('https://example.com/a'))).resolves.toMatchObject({
      ok: false,
      code: 'redirect_loop',
    })
    expect(upstream.requests).toHaveLength(2)
  })

  it('refuses a redirect with no destination', async () => {
    const { retrieval, upstream } = harness()
    upstream.stub('https://example.com/feed', { status: 302 })

    await expect(retrieval.retrieveBytes(feedRequest('https://example.com/feed'))).resolves.toMatchObject({
      ok: false,
      code: 'invalid_redirect',
    })
  })
})

describe('giving up', () => {
  it('abandons a host that answers too slowly and closes the connection', async () => {
    const { retrieval, upstream } = harness()
    upstream.stub('https://example.com/feed.xml', {
      delayMs: 2_000,
      headers: { 'content-type': 'application/xml' },
      body: '<rss></rss>',
    })

    await expect(
      retrieval.retrieveBytes(feedRequest('https://example.com/feed.xml', { timeoutMs: 20 })),
    ).resolves.toMatchObject({ ok: false, code: 'timeout' })
    expect(upstream.aborted).toContain('https://example.com/feed.xml')
  })

  it('stops when the caller no longer wants the answer', async () => {
    const { retrieval, upstream } = harness()
    upstream.stub('https://example.com/feed.xml', {
      delayMs: 2_000,
      headers: { 'content-type': 'application/xml' },
      body: '<rss></rss>',
    })
    const caller = new AbortController()
    setTimeout(() => caller.abort(), 10)

    await expect(
      retrieval.retrieveBytes(feedRequest('https://example.com/feed.xml', { signal: caller.signal })),
    ).resolves.toMatchObject({ ok: false, code: 'cancelled' })
    expect(upstream.aborted).toContain('https://example.com/feed.xml')
  })

  it('does not start work the caller has already abandoned', async () => {
    const { retrieval, upstream } = harness()
    const caller = new AbortController()
    caller.abort()

    await expect(
      retrieval.retrieveBytes(feedRequest('https://example.com/feed.xml', { signal: caller.signal })),
    ).resolves.toMatchObject({ ok: false, code: 'cancelled' })
    expect(upstream.requests).toHaveLength(0)
  })

  it('counts the deadline across redirects rather than restarting it each hop', async () => {
    const { retrieval, upstream } = harness()
    upstream.stub('https://example.com/a', {
      status: 302,
      delayMs: 30,
      headers: { location: 'https://example.com/b' },
    })
    upstream.stub('https://example.com/b', {
      status: 302,
      delayMs: 30,
      headers: { location: 'https://example.com/c' },
    })
    upstream.stub('https://example.com/c', {
      headers: { 'content-type': 'application/xml' },
      body: '<rss></rss>',
    })

    await expect(
      retrieval.retrieveBytes(feedRequest('https://example.com/a', { timeoutMs: 40 })),
    ).resolves.toMatchObject({ ok: false, code: 'timeout' })
  })
})

describe('capacity', () => {
  it('refuses work once the boundary and its queue are full', async () => {
    const { retrieval, upstream } = harness({ maxConcurrent: 1, maxQueued: 0 })
    upstream.stub('https://example.com/feed.xml', {
      delayMs: 50,
      headers: { 'content-type': 'application/xml' },
      body: '<rss></rss>',
    })

    const first = retrieval.retrieveBytes(feedRequest('https://example.com/feed.xml'))
    const second = await retrieval.retrieveBytes(feedRequest('https://example.com/feed.xml'))

    expect(second).toMatchObject({ ok: false, code: 'busy' })
    await expect(first).resolves.toMatchObject({ ok: true })
  })

  it('queues within the budget rather than refusing immediately', async () => {
    const { retrieval, upstream } = harness({ maxConcurrent: 1, maxQueued: 4 })
    upstream.stub('https://example.com/feed.xml', {
      delayMs: 10,
      headers: { 'content-type': 'application/xml' },
      body: '<rss></rss>',
    })

    const results = await Promise.all([
      retrieval.retrieveBytes(feedRequest('https://example.com/feed.xml')),
      retrieval.retrieveBytes(feedRequest('https://example.com/feed.xml')),
      retrieval.retrieveBytes(feedRequest('https://example.com/feed.xml')),
    ])

    expect(results.every((result) => result.ok)).toBe(true)
  })

  it('frees the slot again once a finished retrieval releases it', async () => {
    const { retrieval, upstream } = harness({ maxConcurrent: 1, maxQueued: 0 })
    upstream.stub('https://example.com/feed.xml', {
      headers: { 'content-type': 'application/xml' },
      body: '<rss></rss>',
    })

    await retrieval.retrieveBytes(feedRequest('https://example.com/feed.xml'))
    await expect(retrieval.retrieveBytes(feedRequest('https://example.com/feed.xml'))).resolves.toMatchObject({
      ok: true,
    })
  })

  it('keeps a scoped budget from consuming the whole boundary', async () => {
    const { retrieval, upstream } = harness({ maxConcurrent: 4, maxQueued: 0 })
    const images = retrieval.scoped({ name: 'image', maxConcurrent: 1, maxQueued: 0 })
    upstream.stub('https://example.com/photo.jpg', {
      delayMs: 50,
      headers: { 'content-type': 'image/jpeg' },
      body: new Uint8Array([1, 2, 3]),
    })
    const imageRequest = feedRequest('https://example.com/photo.jpg', {
      operation: 'image',
      accept: ['image/jpeg'],
    })

    const held = images.retrieveBytes(imageRequest)
    const refused = await images.retrieveBytes(imageRequest)
    const elsewhere = await retrieval.retrieveBytes(imageRequest)

    expect(refused).toMatchObject({ ok: false, code: 'busy' })
    expect(elsewhere).toMatchObject({ ok: true })
    await expect(held).resolves.toMatchObject({ ok: true })
  })

  it('does not let work queued for a scoped budget hold the shared capacity', async () => {
    const { retrieval, upstream } = harness({ maxConcurrent: 2, maxQueued: 0 })
    const images = retrieval.scoped({ name: 'image', maxConcurrent: 1, maxQueued: 4 })
    upstream.stub('https://example.com/photo.jpg', {
      delayMs: 50,
      headers: { 'content-type': 'image/jpeg' },
      body: new Uint8Array([1, 2, 3]),
    })
    upstream.stub('https://example.com/feed.xml', {
      headers: { 'content-type': 'application/xml' },
      body: '<rss></rss>',
    })
    const imageRequest = feedRequest('https://example.com/photo.jpg', {
      operation: 'image',
      accept: ['image/jpeg'],
    })

    // One image runs; the other two wait for the image budget, not for the
    // boundary as a whole.
    const images_ = [images.retrieveBytes(imageRequest), images.retrieveBytes(imageRequest)]
    const queued = images.retrieveBytes(imageRequest)

    await expect(retrieval.retrieveBytes(feedRequest('https://example.com/feed.xml'))).resolves.toMatchObject({
      ok: true,
    })
    for (const image of [...images_, queued]) await expect(image).resolves.toMatchObject({ ok: true })
  })

  it('releases the slot when a streamed body is abandoned without being read', async () => {
    const { retrieval, upstream } = harness({ maxConcurrent: 1, maxQueued: 0 })
    upstream.stubDynamic('https://example.com/photo.jpg', () => ({
      headers: { 'content-type': 'image/jpeg' },
      body: chunkedBody([new Uint8Array(8), new Uint8Array(8)]),
    }))
    const imageRequest = feedRequest('https://example.com/photo.jpg', {
      operation: 'image',
      accept: ['image/jpeg'],
      timeoutMs: 20,
    })

    // Nobody reads or cancels it: the deadline is the only thing left to end it.
    expect(await retrieval.retrieve(imageRequest)).toMatchObject({ ok: true })
    await new Promise((resolve) => setTimeout(resolve, 60))

    await expect(retrieval.retrieveBytes(imageRequest)).resolves.toMatchObject({ ok: true })
  })

  it('releases the slot when a streamed body is cancelled unread', async () => {
    const { retrieval, upstream } = harness({ maxConcurrent: 1, maxQueued: 0 })
    upstream.stubDynamic('https://example.com/photo.jpg', () => ({
      headers: { 'content-type': 'image/jpeg' },
      body: chunkedBody([new Uint8Array(8), new Uint8Array(8)]),
    }))
    const imageRequest = feedRequest('https://example.com/photo.jpg', {
      operation: 'image',
      accept: ['image/jpeg'],
    })

    const streamed = await retrieval.retrieve(imageRequest)
    expect(streamed.ok).toBe(true)
    if (streamed.ok) await streamed.body.cancel()

    await expect(retrieval.retrieveBytes(imageRequest)).resolves.toMatchObject({ ok: true })
  })
})

describe('streaming', () => {
  it('hands the caller bytes as they arrive rather than after the whole body', async () => {
    const { retrieval, upstream } = harness()
    upstream.stubDynamic('https://example.com/photo.jpg', () => ({
      headers: { 'content-type': 'image/jpeg' },
      body: chunkedBody([new Uint8Array([1]), new Uint8Array([2]), new Uint8Array([3])]),
    }))

    const result = await retrieval.retrieve(
      feedRequest('https://example.com/photo.jpg', { operation: 'image', accept: ['image/jpeg'] }),
    )

    expect(result.ok).toBe(true)
    if (!result.ok) return
    const reader = result.body.getReader()
    await expect(reader.read()).resolves.toMatchObject({ done: false, value: new Uint8Array([1]) })
    await reader.cancel()
  })

  it('errors the stream with a category the caller can act on', async () => {
    const { retrieval, upstream } = harness()
    upstream.stubDynamic('https://example.com/photo.jpg', () => ({
      headers: { 'content-type': 'image/jpeg' },
      body: chunkedBody([new Uint8Array(64), new Uint8Array(64)]),
    }))

    const result = await retrieval.retrieve(
      feedRequest('https://example.com/photo.jpg', {
        operation: 'image',
        accept: ['image/jpeg'],
        maxBytes: 100,
      }),
    )

    expect(result.ok).toBe(true)
    if (!result.ok) return
    await expect(new Response(result.body).arrayBuffer()).rejects.toMatchObject({ code: 'too_large' })
  })
})

describe('logging', () => {
  it('records the operation and category without the query string', async () => {
    const { retrieval, upstream, logs } = harness()
    upstream.stub('https://example.com/feed.xml?token=secret-value', {
      headers: { 'content-type': 'text/html' },
      body: '<html></html>',
    })

    await retrieval.retrieveBytes(feedRequest('https://example.com/feed.xml?token=secret-value'))

    const record = logs.find((entry) => entry['message'] === 'upstream.retrieval_failed')
    expect(record).toMatchObject({
      operation: 'feed',
      code: 'unsupported_content_type',
      host: 'example.com',
      path: '/feed.xml',
    })
    expect(JSON.stringify(logs)).not.toContain('secret-value')
  })

  it('records a completed retrieval with what it cost', async () => {
    const { retrieval, upstream, logs } = harness()
    upstream.stub('https://example.com/feed.xml', {
      headers: { 'content-type': 'application/xml' },
      body: '<rss></rss>',
    })

    await retrieval.retrieveBytes(feedRequest('https://example.com/feed.xml'))

    expect(logs.find((entry) => entry['message'] === 'upstream.retrieval_completed')).toMatchObject({
      operation: 'feed',
      host: 'example.com',
      status: 200,
      bytes: 11,
    })
  })
})
