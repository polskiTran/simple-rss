import { describe, expect, it } from 'vitest'
import { READER_CACHE_SECONDS, readerArticleSchema, readerItemSchema } from '../../../src/shared/api.js'
import { claimedDevice, type Device } from '../../support/device.js'
import { startTestService, type TestService } from '../../support/service-harness.js'

const FEED_URL = 'https://journal.example/feed'
const ARTICLE_URL = 'https://journal.example/first-light'

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
        <pre><code class="language-python">def observe():\n    return light</code></pre>
      </article></main>
    </body>
  </html>`

async function readingSetup(
  service: TestService,
  options: { article?: Parameters<TestService['upstream']['stub']>[1] } = {},
): Promise<{ user: Device; feedItemId: number }> {
  service.upstream.stub(FEED_URL, {
    headers: { 'content-type': 'application/rss+xml' },
    body: rss(
      item('first-light', 'First light', '2026-08-08T07:15:00.000Z'),
      item('evening', 'Evening notes', '2026-08-07T09:31:00.000Z'),
    ),
  })
  service.upstream.stub(
    ARTICLE_URL,
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
  it('extracts the original page into cacheable, sanitized markdown', async () => {
    const service = await startTestService()
    const { user, feedItemId } = await readingSetup(service)

    const response = await user.get(`/api/items/${feedItemId}/reader`)
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe(`private, max-age=${READER_CACHE_SECONDS}`)

    const article = readerArticleSchema.parse(await response.json())
    expect(article.feedItemId).toBe(feedItemId)
    expect(article.markdown).toContain('Paragraph 7 carries the morning along')
    expect(article.markdown).toContain('## Field methods')
    expect(article.markdown).toContain('```python')
    expect(article.markdown).not.toContain('Archive')
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

  it('asks the publisher once when two devices read at the same time', async () => {
    const service = await startTestService()
    const { user, feedItemId } = await readingSetup(service, {
      article: { headers: { 'content-type': 'text/html' }, body: ARTICLE_HTML, delayMs: 50 },
    })

    const [first, second] = await Promise.all([
      user.get(`/api/items/${feedItemId}/reader`),
      user.get(`/api/items/${feedItemId}/reader`),
    ])

    expect(first?.status).toBe(200)
    expect(second?.status).toBe(200)
    expect(service.upstream.requestsTo(ARTICLE_URL)).toHaveLength(1)
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
  })

  it('lets the offered retry through once, then rate-limits until the cooldown', async () => {
    const service = await startTestService()
    let healed = false
    const { user, feedItemId } = await readingSetup(service)
    service.upstream.stubDynamic(ARTICLE_URL, () =>
      healed
        ? { headers: { 'content-type': 'text/html' }, body: ARTICLE_HTML }
        : { status: 503, headers: { 'content-type': 'text/html' }, body: 'down' },
    )

    expect((await user.get(`/api/items/${feedItemId}/reader`)).status).toBe(502)

    expect((await user.get(`/api/items/${feedItemId}/reader`)).status).toBe(502)
    expect(service.upstream.requestsTo(ARTICLE_URL)).toHaveLength(2)

    const tooSoon = await user.get(`/api/items/${feedItemId}/reader`)
    expect(tooSoon.status).toBe(429)
    expect(Number(tooSoon.headers.get('retry-after'))).toBeGreaterThan(0)
    expect(service.upstream.requestsTo(ARTICLE_URL)).toHaveLength(2)

    healed = true
    service.clock.advance(30_000)
    const retried = await user.get(`/api/items/${feedItemId}/reader`)
    expect(retried.status).toBe(200)
    expect(readerArticleSchema.parse(await retried.json()).markdown).toContain('Field methods')

    healed = false
    const failed = await user.get(`/api/items/${feedItemId}/reader`)
    expect(failed.status).toBe(502)
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
