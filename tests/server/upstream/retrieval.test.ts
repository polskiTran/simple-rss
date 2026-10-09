import { afterEach, describe, expect, it, vi } from 'vitest'
import { createLogger, type LogRecord } from '../../../src/server/logger.js'
import type { ResolveAddresses } from '../../../src/server/upstream/destination.js'
import {
  createRetrieval,
  RETRIEVAL_PROFILES,
  type Retrieval,
  type RetrievalCapacity,
  type RetrievalOperation,
  type RetrievalRequest,
} from '../../../src/server/upstream/retrieval.js'
import { chunkedBody, pacedBody, UpstreamFixtures } from '../../support/upstream-fixtures.js'

interface Harness {
  readonly retrieval: Retrieval
  readonly upstream: UpstreamFixtures
  readonly logs: readonly LogRecord[]
}

interface HarnessOptions {
  readonly addresses?: Record<string, readonly string[]>
  readonly resolve?: ResolveAddresses
  readonly self?: URL
  readonly maxConcurrent?: number
  readonly maxQueued?: number
  readonly operationCapacity?: Partial<Record<RetrievalOperation, RetrievalCapacity>>
}

function harness(options: HarnessOptions = {}): Harness {
  const upstream = new UpstreamFixtures()
  const logs: LogRecord[] = []
  const addresses = options.addresses ?? { 'example.com': ['93.184.216.34'] }

  const retrieval = createRetrieval({
    httpClient: upstream.client,
    logger: createLogger({ level: 'debug', sink: (record) => logs.push(record) }),
    resolve: options.resolve ?? (async (hostname) => addresses[hostname] ?? []),
    self: options.self ?? new URL('https://reader.test'),
    ...(options.maxConcurrent === undefined
      ? {}
      : { capacity: { maxConcurrent: options.maxConcurrent, maxQueued: options.maxQueued ?? 0 } }),
    ...(options.operationCapacity ? { operationCapacity: options.operationCapacity } : {}),
  })

  return { retrieval, upstream, logs }
}

const FEED = RETRIEVAL_PROFILES.feed
const IMAGE = RETRIEVAL_PROFILES.image

function feedRequest(url: string, overrides: Partial<Omit<RetrievalRequest, 'url'>> = {}): RetrievalRequest {
  return { url, operation: 'feed', ...overrides }
}

/** Runs fake time forward, then settles what was already started. */
async function settledAfter<T>(ms: number, pending: Promise<T>): Promise<T> {
  await vi.advanceTimersByTimeAsync(ms)
  return pending
}

afterEach(() => {
  vi.useRealTimers()
})

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
    expect(result.charset).toBe('utf-8')
    expect(result.etag).toBe('"v1"')
  })

  it('carries no charset when the publisher declared none', async () => {
    const { retrieval, upstream } = harness()
    upstream.stub('https://example.com/feed.xml', {
      headers: { 'content-type': 'application/rss+xml' },
      body: '<rss></rss>',
    })

    const result = await retrieval.retrieveBytes(feedRequest('https://example.com/feed.xml'))

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.charset).toBeUndefined()
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
    upstream.stub('https://example.com/photo.jpg', {
      headers: { 'content-type': 'image/jpeg', 'content-length': String(IMAGE.maxBytes + 1) },
      body: 'x',
    })

    await expect(
      retrieval.retrieveBytes(feedRequest('https://example.com/photo.jpg', { operation: 'image' })),
    ).resolves.toMatchObject({ ok: false, code: 'too_large' })
    expect(upstream.aborted).toContain('https://example.com/photo.jpg')
  })

  it('stops a body that passes the ceiling while streaming, with no length declared', async () => {
    const { retrieval, upstream } = harness()
    upstream.stubDynamic('https://example.com/photo.jpg', () => ({
      headers: { 'content-type': 'image/jpeg' },
      body: chunkedBody([new Uint8Array(IMAGE.maxBytes), new Uint8Array(1)]),
    }))

    await expect(
      retrieval.retrieveBytes(feedRequest('https://example.com/photo.jpg', { operation: 'image' })),
    ).resolves.toMatchObject({ ok: false, code: 'too_large' })
  })

  it('stops a body that lied about its length', async () => {
    const { retrieval, upstream } = harness()
    upstream.stubDynamic('https://example.com/photo.jpg', () => ({
      headers: { 'content-type': 'image/jpeg', 'content-length': '10' },
      body: chunkedBody([new Uint8Array(IMAGE.maxBytes), new Uint8Array(1)]),
    }))

    await expect(
      retrieval.retrieveBytes(feedRequest('https://example.com/photo.jpg', { operation: 'image' })),
    ).resolves.toMatchObject({ ok: false, code: 'too_large' })
  })

  it('accepts a body exactly at the ceiling', async () => {
    const { retrieval, upstream } = harness()
    upstream.stubDynamic('https://example.com/photo.jpg', () => ({
      headers: { 'content-type': 'image/jpeg' },
      body: chunkedBody([new Uint8Array(IMAGE.maxBytes)]),
    }))

    const result = await retrieval.retrieveBytes(feedRequest('https://example.com/photo.jpg', { operation: 'image' }))

    expect(result.ok).toBe(true)
    expect(result.ok && result.bytes.byteLength).toBe(IMAGE.maxBytes)
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
      self: new URL('https://reader.test'),
    })

    await expect(retrieval.retrieveBytes(feedRequest('https://example.com/feed.xml'))).resolves.toMatchObject({
      ok: false,
      code: 'unavailable',
    })
  })

  it('answers a conditional request that was not modified with no body', async () => {
    const { retrieval, upstream } = harness()
    upstream.stub('https://example.com/feed.xml', { status: 304, headers: { etag: '"v1"' } })
    const lastModified = 'Fri, 08 Aug 2026 07:00:00 GMT'

    const result = await retrieval.retrieveBytes(
      feedRequest('https://example.com/feed.xml', { conditional: { etag: '"v1"', lastModified } }),
    )

    expect(result).toMatchObject({ ok: true, status: 304, notModified: true, etag: '"v1"' })
    expect(result.ok && result.bytes.byteLength).toBe(0)
    expect(upstream.requestsTo('https://example.com/feed.xml')[0]?.headers).toMatchObject({
      'if-none-match': '"v1"',
      'if-modified-since': lastModified,
    })
  })
})

describe('redirects', () => {
  it('follows a redirect and reports where the bytes came from', async () => {
    const { retrieval, upstream } = harness({
      addresses: { 'example.com': ['93.184.216.34'], 'cdn.example.net': ['93.184.216.35'] },
    })
    upstream.stub('https://example.com/feed', {
      status: 301,
      headers: { location: 'https://cdn.example.net/feed.xml' },
    })
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

  it('pins each hop to the answer its own validation approved, asking the resolver once', async () => {
    const asked: string[] = []
    const { retrieval, upstream } = harness({
      // Answers public to the first query and rebinds to loopback for any later one.
      resolve: async (hostname) => {
        asked.push(hostname)
        return asked.length === 1 ? ['93.184.216.34'] : ['127.0.0.1']
      },
    })
    upstream.stub('https://example.com/feed.xml', {
      headers: { 'content-type': 'application/xml' },
      body: '<rss></rss>',
    })

    await expect(retrieval.retrieveBytes(feedRequest('https://example.com/feed.xml'))).resolves.toMatchObject({
      ok: true,
    })
    expect(asked).toEqual(['example.com'])
    expect(upstream.requests.map((request) => request.addresses)).toEqual([['93.184.216.34']])
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
    vi.useFakeTimers()
    const { retrieval, upstream } = harness()
    upstream.stub('https://example.com/feed.xml', {
      delayMs: FEED.timeoutMs * 2,
      headers: { 'content-type': 'application/xml' },
      body: '<rss></rss>',
    })

    await expect(
      settledAfter(FEED.timeoutMs, retrieval.retrieveBytes(feedRequest('https://example.com/feed.xml'))),
    ).resolves.toMatchObject({ ok: false, code: 'timeout' })
    expect(upstream.aborted).toContain('https://example.com/feed.xml')
  })

  it('returns at the deadline while a DNS lookup remains stuck and bounds further DNS work', async () => {
    vi.useFakeTimers()
    let resolutions = 0
    const { retrieval } = harness({
      maxConcurrent: 1,
      maxQueued: 0,
      resolve: async () => {
        resolutions += 1
        return new Promise<readonly string[]>(() => {})
      },
    })

    await expect(
      settledAfter(FEED.timeoutMs, retrieval.retrieveBytes(feedRequest('https://example.com/feed.xml'))),
    ).resolves.toMatchObject({ ok: false, code: 'timeout' })
    await expect(retrieval.retrieveBytes(feedRequest('https://example.com/feed.xml'))).resolves.toMatchObject({
      ok: false,
      code: 'busy',
    })
    expect(resolutions).toBe(1)
  })

  it('cancels while DNS resolution is still pending', async () => {
    let started: (() => void) | undefined
    const resolving = new Promise<void>((resolve) => {
      started = resolve
    })
    const { retrieval } = harness({
      resolve: async () => {
        started?.()
        return new Promise<readonly string[]>(() => {})
      },
    })
    const caller = new AbortController()
    const pending = retrieval.retrieveBytes(feedRequest('https://example.com/feed.xml', { signal: caller.signal }))
    await resolving
    caller.abort()

    await expect(pending).resolves.toMatchObject({ ok: false, code: 'cancelled' })
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

  it('lets a large body take longer to arrive than the publisher had to answer', async () => {
    vi.useFakeTimers()
    const { retrieval, upstream } = harness()
    const gapMs = FEED.timeoutMs / 2
    upstream.stubDynamic('https://example.com/feed.xml', () => ({
      headers: { 'content-type': 'application/xml' },
      body: pacedBody([new Uint8Array(8), new Uint8Array(8), new Uint8Array(8)], { gapMs }),
    }))

    const result = await settledAfter(gapMs * 4, retrieval.retrieveBytes(feedRequest('https://example.com/feed.xml')))

    expect(result).toMatchObject({ ok: true })
    if (result.ok) expect(result.bytes.byteLength).toBe(24)
  })

  it('reports a body that stops arriving as a body timeout rather than an unanswered request', async () => {
    vi.useFakeTimers()
    const { retrieval, upstream } = harness()
    upstream.stubDynamic('https://example.com/feed.xml', () => ({
      headers: { 'content-type': 'application/xml' },
      body: pacedBody([new Uint8Array(8)], { gapMs: 5, ends: false }),
    }))

    await expect(
      settledAfter(FEED.bodyTimeoutMs, retrieval.retrieveBytes(feedRequest('https://example.com/feed.xml'))),
    ).resolves.toMatchObject({ ok: false, code: 'body_timeout' })
    expect(upstream.aborted).toContain('https://example.com/feed.xml')
  })

  it('counts the deadline across redirects rather than restarting it each hop', async () => {
    vi.useFakeTimers()
    const { retrieval, upstream } = harness()
    const hopMs = FEED.timeoutMs * 0.6
    upstream.stub('https://example.com/a', {
      status: 302,
      delayMs: hopMs,
      headers: { location: 'https://example.com/b' },
    })
    upstream.stub('https://example.com/b', {
      status: 302,
      delayMs: hopMs,
      headers: { location: 'https://example.com/c' },
    })
    upstream.stub('https://example.com/c', {
      headers: { 'content-type': 'application/xml' },
      body: '<rss></rss>',
    })

    await expect(
      settledAfter(FEED.timeoutMs, retrieval.retrieveBytes(feedRequest('https://example.com/a'))),
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

  it('keeps an operation budget from consuming the whole boundary', async () => {
    const { retrieval, upstream } = harness({
      maxConcurrent: 4,
      maxQueued: 0,
      operationCapacity: { image: { maxConcurrent: 1, maxQueued: 0 } },
    })
    upstream.stub('https://example.com/photo.jpg', {
      delayMs: 50,
      headers: { 'content-type': 'image/jpeg' },
      body: new Uint8Array([1, 2, 3]),
    })
    upstream.stub('https://example.com/feed.xml', {
      headers: { 'content-type': 'application/xml' },
      body: '<rss></rss>',
    })
    const imageRequest = feedRequest('https://example.com/photo.jpg', { operation: 'image' })

    const held = retrieval.retrieveBytes(imageRequest)
    const refused = await retrieval.retrieveBytes(imageRequest)
    const elsewhere = await retrieval.retrieveBytes(feedRequest('https://example.com/feed.xml'))

    expect(refused).toMatchObject({ ok: false, code: 'busy' })
    expect(elsewhere).toMatchObject({ ok: true })
    await expect(held).resolves.toMatchObject({ ok: true })
  })

  it('does not let work queued for an operation hold shared capacity', async () => {
    const { retrieval, upstream } = harness({
      maxConcurrent: 2,
      maxQueued: 0,
      operationCapacity: { image: { maxConcurrent: 1, maxQueued: 4 } },
    })
    upstream.stub('https://example.com/photo.jpg', {
      delayMs: 50,
      headers: { 'content-type': 'image/jpeg' },
      body: new Uint8Array([1, 2, 3]),
    })
    upstream.stub('https://example.com/feed.xml', {
      headers: { 'content-type': 'application/xml' },
      body: '<rss></rss>',
    })
    const imageRequest = feedRequest('https://example.com/photo.jpg', { operation: 'image' })

    const images = [retrieval.retrieveBytes(imageRequest), retrieval.retrieveBytes(imageRequest)]
    const queued = retrieval.retrieveBytes(imageRequest)

    await expect(retrieval.retrieveBytes(feedRequest('https://example.com/feed.xml'))).resolves.toMatchObject({
      ok: true,
    })
    for (const image of [...images, queued]) await expect(image).resolves.toMatchObject({ ok: true })
  })

  it('releases the slot when a streamed body is abandoned without being read', async () => {
    vi.useFakeTimers()
    const { retrieval, upstream } = harness({ maxConcurrent: 1, maxQueued: 0 })
    upstream.stubDynamic('https://example.com/photo.jpg', () => ({
      headers: { 'content-type': 'image/jpeg' },
      body: chunkedBody([new Uint8Array(8), new Uint8Array(8)]),
    }))
    const imageRequest = feedRequest('https://example.com/photo.jpg', { operation: 'image' })

    expect(await retrieval.retrieve(imageRequest)).toMatchObject({ ok: true })
    await vi.advanceTimersByTimeAsync(IMAGE.bodyTimeoutMs)

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

    const result = await retrieval.retrieve(feedRequest('https://example.com/photo.jpg', { operation: 'image' }))

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
      body: chunkedBody([new Uint8Array(IMAGE.maxBytes), new Uint8Array(1)]),
    }))

    const result = await retrieval.retrieve(feedRequest('https://example.com/photo.jpg', { operation: 'image' }))

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

    const record = logs.find((entry) => entry.message === 'upstream.retrieval_failed')
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

    expect(logs.find((entry) => entry.message === 'upstream.retrieval_completed')).toMatchObject({
      operation: 'feed',
      host: 'example.com',
      status: 200,
      bytes: 11,
    })
  })

  it('stamps a caller trace id on its records', async () => {
    const { retrieval, upstream, logs } = harness()
    upstream.stub('https://example.com/feed.xml', {
      headers: { 'content-type': 'application/xml' },
      body: '<rss></rss>',
    })

    await retrieval.retrieveBytes(feedRequest('https://example.com/feed.xml', { trace: 'one-reader-operation' }))

    expect(logs.find((entry) => entry.message === 'upstream.retrieval_completed')).toMatchObject({
      trace: 'one-reader-operation',
    })
  })
})

describe('phase log', () => {
  const completed = (logs: readonly LogRecord[]) =>
    logs.find((entry) => entry.message === 'upstream.retrieval_completed')
  const failed = (logs: readonly LogRecord[]) => logs.find((entry) => entry.message === 'upstream.retrieval_failed')

  it('records non-negative phases where they occurred', async () => {
    const { retrieval, upstream, logs } = harness()
    upstream.stub('https://example.com/feed.xml', {
      headers: { 'content-type': 'application/xml' },
      body: '<rss></rss>',
    })

    await retrieval.retrieveBytes(feedRequest('https://example.com/feed.xml'))

    const record = completed(logs)
    for (const phase of ['queueMs', 'dnsMs', 'ttfbMs', 'bodyMs', 'durationMs'] as const) {
      expect(record?.[phase], phase).toBeGreaterThanOrEqual(0)
    }
    expect(record).toMatchObject({ bytes: 11, redirects: 0 })
  })

  it('represents a reused connection as skipped phases, not zero elapsed time', async () => {
    const { retrieval, upstream, logs } = harness()
    upstream.stub('https://example.com/feed.xml', {
      headers: { 'content-type': 'application/xml' },
      body: '<rss></rss>',
    })

    await retrieval.retrieveBytes(feedRequest('https://example.com/feed.xml'))

    const record = completed(logs)
    expect(record).toMatchObject({ connectionReused: true })
    expect(record).not.toHaveProperty('connectMs')
    expect(record).not.toHaveProperty('tlsMs')
  })

  it('carries fresh-connection phases from the transport into the record', async () => {
    const logs: LogRecord[] = []
    const retrieval = createRetrieval({
      httpClient: async (_request, { onTimings }) => {
        onTimings?.({ connectionReused: false, connectMs: 8, tlsMs: 12.25, ttfbMs: 40 })
        return new Response('<rss></rss>', { headers: { 'content-type': 'application/xml' } })
      },
      logger: createLogger({ level: 'debug', sink: (record) => logs.push(record) }),
      resolve: async () => ['93.184.216.34'],
      self: new URL('https://reader.test'),
    })

    await retrieval.retrieveBytes(feedRequest('https://example.com/feed.xml'))

    expect(completed(logs)).toMatchObject({ connectionReused: false, connectMs: 8, tlsMs: 12.25, ttfbMs: 40 })
  })

  it('closes a timeout with a terminal record and no invented body phase', async () => {
    vi.useFakeTimers()
    const { retrieval, upstream, logs } = harness()
    upstream.stub('https://example.com/feed.xml', {
      headers: { 'content-type': 'application/xml' },
      body: '<rss></rss>',
      delayMs: FEED.timeoutMs * 2,
    })

    await settledAfter(FEED.timeoutMs, retrieval.retrieveBytes(feedRequest('https://example.com/feed.xml')))

    const record = failed(logs)
    expect(record).toMatchObject({ code: 'timeout' })
    expect(record?.queueMs).toBeGreaterThanOrEqual(0)
    expect(record?.durationMs).toBeGreaterThanOrEqual(0)
    expect(record).not.toHaveProperty('bodyMs')
    expect(record).not.toHaveProperty('bytes')
  })

  it('closes a capacity refusal with a terminal record', async () => {
    const { retrieval, upstream, logs } = harness({ operationCapacity: { feed: { maxConcurrent: 1, maxQueued: 0 } } })
    upstream.stub('https://example.com/feed.xml', {
      headers: { 'content-type': 'application/xml' },
      body: '<rss></rss>',
      delayMs: 50,
    })

    const holding = retrieval.retrieveBytes(feedRequest('https://example.com/feed.xml'))
    await expect(retrieval.retrieveBytes(feedRequest('https://example.com/feed.xml'))).resolves.toMatchObject({
      ok: false,
      code: 'busy',
    })
    await holding

    const record = failed(logs)
    expect(record).toMatchObject({ code: 'busy' })
    expect(record?.queueMs).toBeGreaterThanOrEqual(0)
    expect(record?.durationMs).toBeGreaterThanOrEqual(0)
  })
})
