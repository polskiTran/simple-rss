import { describe, expect, it, vi } from 'vitest'
import { apiErrorSchema, readerItemSchema } from '../../../src/shared/api.js'
import { RETRIEVAL_PROFILES } from '../../../src/server/upstream/retrieval.js'
import { claimedDevice, type Device } from '../../support/device.js'
import { ReaderWorkerFixtures } from '../../support/reader-worker-fixtures.js'
import { startTestService, type TestService } from '../../support/service-harness.js'
import { pacedBody } from '../../support/upstream-fixtures.js'

const FEED_URL = 'https://journal.example/feed'

const articleUrl = (guid: string) => `https://journal.example/${guid}`

const ARTICLE_HTML = `<!doctype html>
  <html lang="en">
    <head><meta charset="utf-8"><title>First light</title></head>
    <body><main><article>
      <h1>First light</h1>
      ${Array.from({ length: 12 }, (_, index) => `<p>Paragraph ${index} follows the light across the valley with a steady sentence, long enough to read as honest prose.</p>`).join('\n')}
    </article></main></body>
  </html>`

const HTML_HEADERS = { 'content-type': 'text/html; charset=utf-8' }

const rss = (guids: readonly string[]) => `<?xml version="1.0"?>
  <rss version="2.0"><channel><title>Field Notes</title>${guids
    .map(
      (guid, index) => `
    <item>
      <guid>${guid}</guid>
      <title>${guid}</title>
      <link>${articleUrl(guid)}</link>
      <pubDate>${new Date(Date.UTC(2026, 7, 8, 7, index)).toUTCString()}</pubDate>
      <description>A clear morning over the valley.</description>
    </item>`,
    )
    .join('')}</channel></rss>`

async function readingSetup(
  service: TestService,
  guids: readonly string[],
): Promise<{ user: Device; ids: ReadonlyMap<string, number> }> {
  service.upstream.stub(FEED_URL, { headers: { 'content-type': 'application/rss+xml' }, body: rss(guids) })

  const user = await claimedDevice(service)
  expect((await user.post('/api/subscriptions', { url: FEED_URL })).status).toBe(201)
  await service.wakeScheduler()

  const digest = (await (await user.get('/api/digest')).json()) as {
    groups: { items: { title: string; feedItemId: number }[] }[]
  }
  const items = digest.groups.flatMap((group) => group.items)
  const ids = new Map(guids.map((guid) => [guid, items.find((entry) => entry.title === guid)?.feedItemId]))
  for (const [guid, id] of ids) {
    if (id === undefined) throw new Error(`"${guid}" is not in the Digest`)
  }
  return { user, ids: ids as ReadonlyMap<string, number> }
}

async function expectDeadline(response: Response, stage: 'publisher' | 'parsing'): Promise<void> {
  expect(response.status).toBe(504)
  expect(response.headers.get('cache-control')).toBe('no-store')
  const { error } = apiErrorSchema.parse(await response.json())
  expect(error.code).toBe('article_deadline_exceeded')
  expect(error.stage).toBe(stage)
}

const extracted = (service: TestService) =>
  service.logs.find((record) => record.message === 'reader.trace' && record.outcome === 'extracted')

describe('the Reader budget', () => {
  it('answers every waiter at the deadline and leaves the retrieval running', async () => {
    const service = await startTestService({ readerBudgetMs: 300 })
    const { user, ids } = await readingSetup(service, ['first-light'])
    const feedItemId = ids.get('first-light')
    service.upstream.stub(articleUrl('first-light'), { headers: HTML_HEADERS, body: ARTICLE_HTML, delayMs: 60_000 })

    const responses = await Promise.all([
      user.get(`/api/items/${feedItemId}/reader`),
      user.get(`/api/items/${feedItemId}/reader`),
    ])
    for (const response of responses) await expectDeadline(response, 'publisher')

    expect(service.upstream.requestsTo(articleUrl('first-light'))).toHaveLength(1)
    expect(service.upstream.aborted).not.toContain(articleUrl('first-light'))
    expect(service.logs.filter((record) => record.message === 'reader.deadline')).toEqual(
      expect.arrayContaining([expect.objectContaining({ feedItemId, stage: 'publisher' })]),
    )

    const item = readerItemSchema.parse(await (await user.get(`/api/items/${feedItemId}`)).json())
    expect(item.summary).toBe('A clear morning over the valley.')
  })

  it('finishes detached work and hands the article to the refetch without asking the publisher again', async () => {
    const service = await startTestService({ readerBudgetMs: 300 })
    const { user, ids } = await readingSetup(service, ['first-light'])
    const feedItemId = ids.get('first-light')
    service.upstream.stub(articleUrl('first-light'), { headers: HTML_HEADERS, body: ARTICLE_HTML, delayMs: 900 })

    await expectDeadline(await user.get(`/api/items/${feedItemId}/reader`), 'publisher')

    const joined = await user.get(`/api/items/${feedItemId}/reader`)
    await expectDeadline(joined, 'publisher')

    await vi.waitFor(() => expect(extracted(service)).toBeDefined(), { timeout: 5_000 })
    const collected = await user.get(`/api/items/${feedItemId}/reader`)
    expect(collected.status).toBe(200)
    const article = (await collected.json()) as { markdown: string }
    expect(article.markdown).toContain('follows the light across the valley')

    expect(service.upstream.requestsTo(articleUrl('first-light'))).toHaveLength(1)
  })

  it('expires an operation still queued for a retrieval slot with the same contract', async () => {
    const slots = RETRIEVAL_PROFILES.reader.capacity.maxConcurrent
    const guids = Array.from({ length: slots + 1 }, (_, index) => `item-${index}`)
    const service = await startTestService({ readerBudgetMs: 400 })
    const { user, ids } = await readingSetup(service, guids)
    for (const guid of guids) {
      service.upstream.stub(articleUrl(guid), { headers: HTML_HEADERS, body: ARTICLE_HTML, delayMs: 60_000 })
    }

    const responses = await Promise.all(guids.map((guid) => user.get(`/api/items/${ids.get(guid)}/reader`)))
    for (const response of responses) await expectDeadline(response, 'publisher')
  })

  it('answers the publisher stage while the body is still arriving', async () => {
    const service = await startTestService({ readerBudgetMs: 300 })
    const { user, ids } = await readingSetup(service, ['first-light'])
    const chunk = new TextEncoder().encode('<p>the body arrives, slowly, and never finishes</p>')
    service.upstream.stub(articleUrl('first-light'), {
      headers: HTML_HEADERS,
      body: pacedBody(
        Array.from({ length: 50 }, () => chunk),
        { gapMs: 60, ends: false },
      ),
    })

    await expectDeadline(await user.get(`/api/items/${ids.get('first-light')}/reader`), 'publisher')
  })

  it('answers the parsing stage for a held worker and stashes its article after release', {
    timeout: 20_000,
  }, async () => {
    const readerWorker = new ReaderWorkerFixtures()
    const service = await startTestService({ readerWorkerUrl: readerWorker.url, readerBudgetMs: 2_000 })
    const { user, ids } = await readingSetup(service, ['item-one'])
    service.upstream.stub(articleUrl('item-one'), { headers: HTML_HEADERS, body: ARTICLE_HTML })
    const held = await readerWorker.holdNext()

    const active = user.get(`/api/items/${ids.get('item-one')}/reader`)
    await held.entered
    await expectDeadline(await active, 'parsing')

    held.release()
    await vi.waitFor(() => expect(extracted(service)).toBeDefined(), { timeout: 5_000 })
    const collected = await user.get(`/api/items/${ids.get('item-one')}/reader`)
    expect(collected.status).toBe(200)
    expect(service.upstream.requestsTo(articleUrl('item-one'))).toHaveLength(1)
  })

  it('keeps deadline answers out of the five-attempt failure allowance', async () => {
    const service = await startTestService({ readerBudgetMs: 300 })
    const { user, ids } = await readingSetup(service, ['first-light'])
    const feedItemId = ids.get('first-light')
    service.upstream.stub(articleUrl('first-light'), { headers: HTML_HEADERS, body: ARTICLE_HTML, delayMs: 60_000 })

    for (let attempt = 0; attempt < 6; attempt += 1) {
      await expectDeadline(await user.get(`/api/items/${feedItemId}/reader`), 'publisher')
    }
    expect(service.upstream.requestsTo(articleUrl('first-light'))).toHaveLength(1)
  })
})
