import { describe, expect, it, vi } from 'vitest'
import { apiErrorSchema, READER_CACHE_SECONDS, readerArticleSchema, readerItemSchema } from '../../../src/shared/api.js'
import { claimedDevice, type Device } from '../../support/device.js'
import { startTestService, type TestService } from '../../support/service-harness.js'
import { cancelledExtractions, queuedExtractions, ReaderWorkerFixtures } from '../../support/reader-worker-fixtures.js'

const FEED_URL = 'https://journal.example/feed'
const ARTICLE_URL = 'https://journal.example/first-light'
const SECOND_ARTICLE_URL = 'https://journal.example/evening'
const ASYNC_EXTRACTOR_TARGET = 'https://www.youtube.com/watch?v=reader-boundary'
const FINAL_ARTICLE_URL = 'https://journal.example/archive/first-light'
const FINAL_ARTICLE_IMAGE_URL = 'https://journal.example/archive/media/dawn-large.jpg'
const FINAL_DECORATIVE_IMAGE_URL = 'https://journal.example/archive/media/divider.png'

const rss = (...items: string[]) => `<?xml version="1.0"?>
  <rss version="2.0"><channel><title>Field Notes</title>${items.join('')}</channel></rss>`

const item = (guid: string, title: string, pubDate: string, link?: string) => `
  <item>
    <guid>${guid}</guid>
    <title>${title}</title>
    ${link === undefined ? `<link>https://journal.example/${guid}</link>` : link}
    <pubDate>${new Date(pubDate).toUTCString()}</pubDate>
    <description>A clear morning over the valley.</description>
  </item>`

const ARTICLE_HTML = `<!doctype html>
  <html lang="en">
    <head><meta charset="utf-8"><title>First light</title></head>
    <body>
      <nav><a href="/">Home</a><a href="/archive">Archive</a></nav>
      <main><article>
        <h1>First light</h1>
        ${Array.from({ length: 30 }, (_, index) => `<p>Paragraph ${index} carries the morning along with a steady sentence about the valley, written long enough to count as honest reading time.</p>`).join('\n')}
        <h2>Field methods</h2>
        <p>Observe <em>carefully</em>, keep a <strong>steady hand</strong>, and run <code>measure()</code>.</p>
        <ul>
          <li>Arrive early enough to watch the valley before the wind changes the light.
            <ul><li>Record the first measurement before moving the camera or changing the lens.</li></ul>
          </li>
          <li>Write every observation in the field notebook while the details remain clear.</li>
        </ul>
        <ol>
          <li>Frame the ridge against the clear morning sky before the clouds arrive.</li>
          <li>Expose the plate using the measured light rather than an automatic estimate.</li>
        </ol>
        <blockquote><p>The valley changes by the minute.</p></blockquote>
        <hr>
        <pre><code class="language-python">def observe():\n    return light</code></pre>
        <table>
          <thead><tr><th>Hour</th><th>Reading</th></tr></thead>
          <tbody><tr><td>06:10</td><td>steady | measured</td></tr></tbody>
        </table>
        <p>Euler wrote <math><semantics><mrow><msup><mi>e</mi><mrow><mi>i</mi><mi>π</mi></mrow></msup><mo>=</mo><mo>−</mo><mn>1</mn></mrow><annotation encoding="application/x-tex">e^{i\\pi} = -1</annotation></semantics></math>.</p>
        <p>The field notebook costs $5 at dawn and $10 after sunrise.</p>
        <p>Read <a href="notes" title="Field notebook">the field notebook</a>.</p>
        <p><a href="javascript:alert(1)">unsafe destination remains readable</a></p>
        <p><a href="https://bad host/notes">malformed destination remains readable</a></p>
        <img src="media/dawn-small.jpg" srcset="media/dawn-small.jpg 320w, media/dawn-large.jpg 1200w" alt="dawn over the valley">
        <img src="media/divider.png" alt="" width="600" height="100">
        <img src="data:image/png;base64,eA==" alt="tracking pixel">
        <img src="https://exa mple/image.png" alt="malformed image">
        <script>document.body.innerHTML = 'hostile'</script>
        <iframe src="https://tracker.example/pixel"></iframe>
        <form action="/subscribe"><button>Subscribe now</button></form>
      </article></main>
    </body>
  </html>`

async function readingSetup(
  service: TestService,
  options: {
    article?: Parameters<TestService['upstream']['stub']>[1]
    articleUrl?: string
  } = {},
): Promise<{ user: Device; feedItemId: number }> {
  const articleUrl = options.articleUrl ?? ARTICLE_URL
  service.upstream.stub(FEED_URL, {
    headers: { 'content-type': 'application/rss+xml' },
    body: rss(
      item('first-light', 'First light', '2026-08-08T07:15:00.000Z', `<link>${articleUrl}</link>`),
      item('evening', 'Evening notes', '2026-08-07T09:31:00.000Z'),
    ),
  })
  service.upstream.stub(
    articleUrl,
    options.article ?? {
      headers: { 'content-type': 'text/html; charset=utf-8' },
      body: ARTICLE_HTML,
    },
  )

  const user = await claimedDevice(service)
  expect((await user.post('/api/subscriptions', { url: FEED_URL })).status).toBe(201)
  await service.wakeScheduler()

  const items = readerItemFind(await (await user.get('/api/digest')).json(), 'First light')
  return { user, feedItemId: items }
}

function readerItemFind(digest: unknown, title: string): number {
  const groups = (digest as { groups: { items: { title: string; feedItemId: number }[] }[] }).groups
  const found = groups.flatMap((group) => group.items).find((entry) => entry.title === title)
  if (!found) throw new Error(`"${title}" is not in the Digest`)
  return found.feedItemId
}

describe('the Reader item', () => {
  it('describes the Feed Item, its save state, and what comes next', async () => {
    const service = await startTestService()
    const { user, feedItemId } = await readingSetup(service)

    const response = await user.get(`/api/items/${feedItemId}`)
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')

    const reader = readerItemSchema.parse(await response.json())
    expect(reader.title).toBe('First light')
    expect(reader.feedTitle).toBe('Field Notes')
    expect(reader.link).toBe(ARTICLE_URL)
    expect(reader.displayDate).toBe('saturday, 8 august')
    expect(reader.summary).toBe('A clear morning over the valley.')
    expect(reader.saved).toBe(false)
    expect(reader.nextInDigest).toMatchObject({ title: 'Evening notes', feedTitle: 'Field Notes' })

    await user.put(`/api/library/${feedItemId}`)
    const saved = readerItemSchema.parse(await (await user.get(`/api/items/${feedItemId}`)).json())
    expect(saved.saved).toBe(true)
  })

  it('answers 404 for Feed Items that do not exist', async () => {
    const service = await startTestService()
    const user = await claimedDevice(service)

    expect((await user.get('/api/items/999')).status).toBe(404)
    expect((await user.get('/api/items/not-an-id')).status).toBe(404)
    expect((await user.get('/api/items/999/reader')).status).toBe(404)
  })

  it('is not readable without a session', async () => {
    const service = await startTestService()
    const { feedItemId } = await readingSetup(service)
    const stranger = await service.fetch(`/api/items/${feedItemId}/reader`)

    expect(stranger.status).toBe(401)
  })
})

describe('the Reader article', () => {
  it('returns the supported Reader dialect with policy-safe destinations', async () => {
    const service = await startTestService()
    service.upstream.stub(FINAL_ARTICLE_URL, {
      headers: { 'content-type': 'text/html; charset=utf-8' },
      body: ARTICLE_HTML,
    })
    const { user, feedItemId } = await readingSetup(service, {
      article: { status: 302, headers: { location: FINAL_ARTICLE_URL } },
    })

    const response = await user.get(`/api/items/${feedItemId}/reader`)
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe(`private, max-age=${READER_CACHE_SECONDS}`)

    const article = readerArticleSchema.parse(await response.json())
    expect(article.feedItemId).toBe(feedItemId)
    expect(article.markdown).toContain('Paragraph 7 carries the morning along')
    expect(article.markdown).not.toContain('Archive')
    expect(article.markdown).toContain('## Field methods')
    expect(article.markdown).toContain('*carefully*')
    expect(article.markdown).toContain('**steady hand**')
    expect(article.markdown).toContain('`measure()`')
    expect(article.markdown).toContain('- Arrive early enough to watch the valley')
    expect(article.markdown).toContain('1. Frame the ridge against the clear morning sky')
    expect(article.markdown).toContain('> The valley changes by the minute.')
    expect(article.markdown).toContain('\n\n---\n\n')
    expect(article.markdown).toContain('```python')
    expect(article.markdown).toMatch(/\|\s*Hour\s*\|\s*Reading\s*\|/)
    expect(article.markdown).toContain('steady \\| measured')
    expect(article.markdown).toContain('$$e^{i\\pi} = -1$$')
    expect(article.markdown).toContain('The field notebook costs $5 at dawn and $10 after sunrise.')
    expect(article.markdown).toContain('[the field notebook](https://journal.example/archive/notes "Field notebook")')
    expect(article.markdown).toContain('unsafe destination remains readable')
    expect(article.markdown).toContain('malformed destination remains readable')
    expect(article.markdown).not.toContain('https://bad host')
    expect(article.markdown).toContain('!\\[malformed image]')
    expect(article.markdown).not.toContain('![malformed image](')
    expect(article.markdown).not.toContain('javascript:')
    expect(article.markdown).not.toContain('data:image')
    expect(article.markdown).not.toContain('tracking pixel')
    expect(article.markdown).not.toMatch(/<(?:script|iframe|form|button)\b/i)
    expect(article.markdown).not.toContain('Subscribe now')

    const imageUrls = [...article.markdown.matchAll(/!\[[^\]]*\]\(([^)]+)\)/g)].map(
      (match) => new URL((match[1] ?? '').replaceAll('\\&', '&'), 'https://reader.test'),
    )
    expect(imageUrls).toHaveLength(2)
    expect(imageUrls.map((url) => url.pathname)).toEqual(['/api/reader/image', '/api/reader/image'])
    expect(imageUrls.map((url) => url.searchParams.get('url'))).toEqual([
      FINAL_ARTICLE_IMAGE_URL,
      FINAL_DECORATIVE_IMAGE_URL,
    ])
    for (const url of imageUrls) {
      expect(url.searchParams.get('exp')).not.toBeNull()
      expect(url.searchParams.get('sig')).not.toBeNull()
    }
    expect(article.readingTimeMinutes).toBeGreaterThanOrEqual(2)
  })

  it('never writes article content to SQLite', async () => {
    const service = await startTestService()
    const { user, feedItemId } = await readingSetup(service)
    expect((await user.get(`/api/items/${feedItemId}/reader`)).status).toBe(200)

    const database = service.database
    if (!database) throw new Error('the service has no database')
    const tables = database.$client.prepare("select name from sqlite_master where type = 'table'").all() as {
      name: string
    }[]
    for (const { name } of tables) {
      const rows = database.$client.prepare(`select * from "${name}"`).all()
      expect(JSON.stringify(rows)).not.toContain('carries the morning along')
    }
  })

  it('keeps shared extraction alive when one of two callers leaves', async () => {
    const readerWorker = new ReaderWorkerFixtures()
    const service = await startTestService({ readerWorkerUrl: readerWorker.url })
    const { user, feedItemId } = await readingSetup(service)
    const held = await readerWorker.holdNext()
    const firstController = new AbortController()

    const first = user.get(`/api/items/${feedItemId}/reader`, firstController.signal)
    const second = user.get(`/api/items/${feedItemId}/reader`)
    await held.entered

    firstController.abort()
    await expect(first).rejects.toMatchObject({ name: 'AbortError' })
    expect(service.upstream.requestsTo(ARTICLE_URL)).toHaveLength(1)

    held.release()
    expect((await second).status).toBe(200)
    expect(service.upstream.requestsTo(ARTICLE_URL)).toHaveLength(1)
  })

  it('keeps authenticated requests responsive while extraction is held', async () => {
    const readerWorker = new ReaderWorkerFixtures()
    const service = await startTestService({ readerWorkerUrl: readerWorker.url })
    const { user, feedItemId } = await readingSetup(service)
    const held = await readerWorker.holdNext()

    const article = user.get(`/api/items/${feedItemId}/reader`)
    await held.entered

    expect((await user.get('/api/digest')).status).toBe(200)
    held.release()
    expect((await article).status).toBe(200)
  })

  it('cancels an active extraction when its final caller leaves and retries immediately', async () => {
    const readerWorker = new ReaderWorkerFixtures()
    const service = await startTestService({ readerWorkerUrl: readerWorker.url })
    const { user, feedItemId } = await readingSetup(service)
    const held = await readerWorker.holdNext()
    const controller = new AbortController()

    const abandoned = user.get(`/api/items/${feedItemId}/reader`, controller.signal)
    await held.entered
    controller.abort()
    await expect(abandoned).rejects.toMatchObject({ name: 'AbortError' })
    await vi.waitFor(() => expect(cancelledExtractions(service.logs)).toBe(1))

    const retried = user.get(`/api/items/${feedItemId}/reader`)
    await vi.waitFor(() => expect(queuedExtractions(service.logs)).toBe(2))
    expect((await retried).status).toBe(200)
    expect(service.upstream.requestsTo(ARTICLE_URL)).toHaveLength(2)
  })

  it('removes a cancelled queued extraction before accepting a fresh request', async () => {
    const readerWorker = new ReaderWorkerFixtures()
    const service = await startTestService({ readerWorkerUrl: readerWorker.url })
    const { user, feedItemId } = await readingSetup(service)
    const digest = await (await user.get('/api/digest')).json()
    const secondFeedItemId = readerItemFind(digest, 'Evening notes')
    service.upstream.stub(SECOND_ARTICLE_URL, {
      headers: { 'content-type': 'text/html' },
      body: ARTICLE_HTML,
    })
    const held = await readerWorker.holdNext()

    const active = user.get(`/api/items/${feedItemId}/reader`)
    await held.entered
    const queuedController = new AbortController()
    const queued = user.get(`/api/items/${secondFeedItemId}/reader`, queuedController.signal)
    await vi.waitFor(() => expect(queuedExtractions(service.logs)).toBe(2))

    queuedController.abort()
    await expect(queued).rejects.toMatchObject({ name: 'AbortError' })
    await vi.waitFor(() => expect(cancelledExtractions(service.logs)).toBe(1))
    const retried = user.get(`/api/items/${secondFeedItemId}/reader`)
    await vi.waitFor(() => expect(queuedExtractions(service.logs)).toBe(3))

    held.release()
    expect((await active).status).toBe(200)
    expect((await retried).status).toBe(200)
    expect(service.upstream.requestsTo(SECOND_ARTICLE_URL)).toHaveLength(2)
  })

  it('degrades a worker crash and replaces it for the next extraction', async () => {
    const readerWorker = new ReaderWorkerFixtures()
    const service = await startTestService({ readerWorkerUrl: readerWorker.url })
    const { user, feedItemId } = await readingSetup(service)
    await readerWorker.crashNext()

    const failed = await user.get(`/api/items/${feedItemId}/reader`)
    expect(failed.status).toBe(422)
    expect(apiErrorSchema.parse(await failed.json()).error.code).toBe('article_unreadable')
    expect((await service.fetch('/health/ready')).status).toBe(200)

    const recovered = await user.get(`/api/items/${feedItemId}/reader`)
    expect(recovered.status).toBe(200)
    expect(readerArticleSchema.parse(await recovered.json()).markdown).toContain('Field methods')
    expect(service.upstream.requestsTo(ARTICLE_URL)).toHaveLength(2)
  })

  it('cancels Reader work that outlives the shutdown grace period', async () => {
    const readerWorker = new ReaderWorkerFixtures()
    const service = await startTestService({ readerWorkerUrl: readerWorker.url })
    const { user, feedItemId } = await readingSetup(service)
    const digest = await (await user.get('/api/digest')).json()
    const secondFeedItemId = readerItemFind(digest, 'Evening notes')
    service.upstream.stub(SECOND_ARTICLE_URL, {
      headers: { 'content-type': 'text/html' },
      body: ARTICLE_HTML,
      delayMs: 5_000,
    })
    const held = await readerWorker.holdNext()

    const extracting = user.get(`/api/items/${feedItemId}/reader`)
    await held.entered
    const retrieving = user.get(`/api/items/${secondFeedItemId}/reader`)
    await vi.waitFor(() => expect(service.upstream.requestsTo(SECOND_ARTICLE_URL)).toHaveLength(1))

    const settled = Promise.allSettled([extracting, retrieving])
    await service.stop()
    await settled

    expect(service.logs.map((record) => record.message)).toContain('server.stop_forced')
    expect(cancelledExtractions(service.logs)).toBe(1)
    expect(service.upstream.aborted).toContain(SECOND_ARTICLE_URL)
  })

  it('cancels orphaned retrieval when the browser leaves the Reader', async () => {
    const service = await startTestService()
    const { user, feedItemId } = await readingSetup(service)
    let attempts = 0
    service.upstream.stubDynamic(ARTICLE_URL, () => {
      attempts += 1
      return attempts === 1
        ? { headers: { 'content-type': 'text/html' }, body: ARTICLE_HTML, delayMs: 5_000 }
        : { headers: { 'content-type': 'text/html' }, body: ARTICLE_HTML }
    })

    const controller = new AbortController()
    const abandoned = user.get(`/api/items/${feedItemId}/reader`, controller.signal)
    await vi.waitFor(() => expect(service.upstream.requestsTo(ARTICLE_URL)).toHaveLength(1))

    controller.abort()
    await expect(abandoned).rejects.toMatchObject({ name: 'AbortError' })
    await vi.waitFor(() => expect(service.upstream.aborted).toContain(ARTICLE_URL))

    const retried = await user.get(`/api/items/${feedItemId}/reader`)
    expect(retried.status).toBe(200)
    expect(service.upstream.requestsTo(ARTICLE_URL)).toHaveLength(2)
  })

  it('keeps asynchronous extractor targets inside Retrieval', async () => {
    const service = await startTestService()
    const { user, feedItemId } = await readingSetup(service, {
      articleUrl: ASYNC_EXTRACTOR_TARGET,
      article: {
        headers: { 'content-type': 'text/html' },
        body: '<!doctype html><html><body></body></html>',
      },
    })

    const originalFetch = globalThis.fetch
    const escapedRequests: string[] = []
    const fetchSentinel = vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      if (url.startsWith(service.url)) return originalFetch(input, init)
      escapedRequests.push(url)
      throw new Error(`process-global network request: ${url}`)
    })

    const response = await user.get(`/api/items/${feedItemId}/reader`).finally(() => fetchSentinel.mockRestore())

    expect(response.status).toBe(422)
    expect(service.upstream.requestsTo(ASYNC_EXTRACTOR_TARGET)).toHaveLength(1)
    expect(escapedRequests).toEqual([])
  })

  it('falls back calmly when the page is not supported HTML', async () => {
    const service = await startTestService()
    const { user, feedItemId } = await readingSetup(service, {
      article: { headers: { 'content-type': 'application/pdf' }, body: '%PDF-1.4' },
    })

    const response = await user.get(`/api/items/${feedItemId}/reader`)
    expect(response.status).toBe(415)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe('unsupported_article')
  })

  it('refuses a page that declares itself larger than the ceiling', async () => {
    const service = await startTestService()
    const { user, feedItemId } = await readingSetup(service, {
      article: {
        headers: { 'content-type': 'text/html', 'content-length': String(6 * 1024 * 1024) },
        body: ARTICLE_HTML,
      },
    })

    const response = await user.get(`/api/items/${feedItemId}/reader`)
    expect(response.status).toBe(413)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe('article_too_large')
  })

  it('reports an unreachable original without touching the Feed Item', async () => {
    const service = await startTestService()
    const { user, feedItemId } = await readingSetup(service, {
      article: { status: 500, headers: { 'content-type': 'text/html' }, body: 'nope' },
    })

    const response = await user.get(`/api/items/${feedItemId}/reader`)
    expect(response.status).toBe(502)
    expect(response.headers.get('cache-control')).toBe('no-store')

    const reader = readerItemSchema.parse(await (await user.get(`/api/items/${feedItemId}`)).json())
    expect(reader.summary).toBe('A clear morning over the valley.')
    expect(reader.saved).toBe(false)
  })

  it('answers 422 when the original page has no readable article', async () => {
    const service = await startTestService()
    const { user, feedItemId } = await readingSetup(service, {
      article: { headers: { 'content-type': 'text/html' }, body: '<!doctype html><html><body></body></html>' },
    })

    const response = await user.get(`/api/items/${feedItemId}/reader`)
    expect(response.status).toBe(422)
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe('article_unreadable')

    const trace = service.logs.find((record) => record.message === 'reader.trace')
    expect(trace).toMatchObject({ outcome: 'unreadable', host: 'journal.example' })
    expect(trace?.domMs).toBeGreaterThanOrEqual(0)
    expect(trace?.defuddleMs).toBeGreaterThanOrEqual(0)
    expect(trace?.totalMs).toBeGreaterThanOrEqual(0)
  })

  it('allows five failed attempts before rate-limiting until the cooldown', async () => {
    const service = await startTestService()
    let healed = false
    const { user, feedItemId } = await readingSetup(service)
    service.upstream.stubDynamic(ARTICLE_URL, () =>
      healed
        ? { headers: { 'content-type': 'text/html' }, body: ARTICLE_HTML }
        : { status: 503, headers: { 'content-type': 'text/html' }, body: 'down' },
    )

    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect((await user.get(`/api/items/${feedItemId}/reader`)).status).toBe(502)
    }
    expect(service.upstream.requestsTo(ARTICLE_URL)).toHaveLength(5)

    const tooSoon = await user.get(`/api/items/${feedItemId}/reader`)
    expect(tooSoon.status).toBe(429)
    expect(Number(tooSoon.headers.get('retry-after'))).toBeGreaterThan(0)
    expect(service.upstream.requestsTo(ARTICLE_URL)).toHaveLength(5)

    healed = true
    service.clock.advance(30_000)
    const retried = await user.get(`/api/items/${feedItemId}/reader`)
    expect(retried.status).toBe(200)
    expect(readerArticleSchema.parse(await retried.json()).markdown).toContain('Field methods')

    healed = false
    const failed = await user.get(`/api/items/${feedItemId}/reader`)
    expect(failed.status).toBe(502)
  })

  it('records one trace correlating retrieval and worker extraction for a Reader operation', async () => {
    const service = await startTestService()
    const { user, feedItemId } = await readingSetup(service)

    expect((await user.get(`/api/items/${feedItemId}/reader`)).status).toBe(200)

    const traces = service.logs.filter((record) => record.message === 'reader.trace')
    expect(traces).toHaveLength(1)
    const trace = traces[0]
    expect(trace).toMatchObject({ outcome: 'extracted', feedItemId, host: 'journal.example', redirects: 0 })
    expect(typeof trace?.trace).toBe('string')
    const phases = [
      'queueMs',
      'dnsMs',
      'ttfbMs',
      'bodyMs',
      'workerQueueMs',
      'domMs',
      'defuddleMs',
      'markdownPolicyMs',
      'totalMs',
    ] as const
    for (const phase of phases) {
      expect(trace?.[phase], phase).toBeGreaterThanOrEqual(0)
    }
    expect(trace?.bytes).toBeGreaterThan(0)
    expect(trace).toMatchObject({ connectionReused: true })
    expect(trace).not.toHaveProperty('connectMs')

    const retrieved = service.logs.find(
      (record) => record.message === 'upstream.retrieval_completed' && record.operation === 'reader',
    )
    expect(retrieved?.trace).toBe(trace?.trace)
  })

  it('keeps article content, summaries, and query strings out of captured logs', async () => {
    const service = await startTestService()
    const { user, feedItemId } = await readingSetup(service, {
      articleUrl: 'https://journal.example/first-light?token=secret-query-value',
    })

    expect((await user.get(`/api/items/${feedItemId}/reader`)).status).toBe(200)

    const everything = JSON.stringify(service.logs)
    expect(everything).toContain('reader.trace')
    expect(everything).not.toContain('secret-query-value')
    expect(everything).not.toContain('carries the morning along')
    expect(everything).not.toContain('A clear morning over the valley')
    expect(everything).not.toContain('<article')
  })

  it('closes a publisher failure with a coherent terminal trace', async () => {
    const service = await startTestService()
    const { user, feedItemId } = await readingSetup(service, {
      article: { status: 503, headers: { 'content-type': 'text/html' }, body: 'down' },
    })

    expect((await user.get(`/api/items/${feedItemId}/reader`)).status).toBe(502)

    const trace = service.logs.find((record) => record.message === 'reader.trace')
    expect(trace).toMatchObject({ outcome: 'http_error', status: 503, host: 'journal.example' })
    expect(trace?.totalMs).toBeGreaterThanOrEqual(0)
    expect(trace).not.toHaveProperty('domMs')
  })

  it('closes an abandoned Reader operation with a cancelled trace', async () => {
    const service = await startTestService()
    const { user, feedItemId } = await readingSetup(service, {
      article: { headers: { 'content-type': 'text/html' }, body: ARTICLE_HTML, delayMs: 5_000 },
    })
    const controller = new AbortController()

    const abandoned = user.get(`/api/items/${feedItemId}/reader`, controller.signal)
    await vi.waitFor(() => expect(service.upstream.requestsTo(ARTICLE_URL)).toHaveLength(1))
    controller.abort()
    await expect(abandoned).rejects.toMatchObject({ name: 'AbortError' })

    await vi.waitFor(() => {
      const trace = service.logs.find((record) => record.message === 'reader.trace')
      expect(trace).toMatchObject({ outcome: 'cancelled', feedItemId })
      expect(trace?.totalMs).toBeGreaterThanOrEqual(0)
    })
  })

  it('closes a worker crash with its own terminal trace', async () => {
    const readerWorker = new ReaderWorkerFixtures()
    const service = await startTestService({ readerWorkerUrl: readerWorker.url })
    const { user, feedItemId } = await readingSetup(service)
    await readerWorker.crashNext()

    expect((await user.get(`/api/items/${feedItemId}/reader`)).status).toBe(422)

    await vi.waitFor(() => {
      const trace = service.logs.find((record) => record.message === 'reader.trace')
      expect(trace).toMatchObject({ outcome: 'worker_failed', host: 'journal.example' })
      expect(trace?.bodyMs).toBeGreaterThanOrEqual(0)
      expect(trace?.totalMs).toBeGreaterThanOrEqual(0)
    })
  })

  it('answers 422 when the Feed Item never had an original link', async () => {
    const service = await startTestService()
    service.upstream.stub(FEED_URL, {
      headers: { 'content-type': 'application/rss+xml' },
      body: rss(item('linkless', 'A linkless note', '2026-08-08T07:15:00.000Z', '')),
    })
    const user = await claimedDevice(service)
    expect((await user.post('/api/subscriptions', { url: FEED_URL })).status).toBe(201)
    await service.wakeScheduler()
    const feedItemId = readerItemFind(await (await user.get('/api/digest')).json(), 'A linkless note')

    const response = await user.get(`/api/items/${feedItemId}/reader`)
    expect(response.status).toBe(422)
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe('no_original_link')
  })
})
