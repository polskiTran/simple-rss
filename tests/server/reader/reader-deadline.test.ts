import { describe, expect, it, vi } from 'vitest'
import { apiErrorSchema, readerItemSchema } from '../../../src/shared/api.js'
import { RETRIEVAL_PROFILES } from '../../../src/server/upstream/retrieval.js'
import { claimedDevice, type Device } from '../../support/device.js'
import { cancelledExtractions, queuedExtractions, ReaderWorkerFixtures } from '../../support/reader-worker-fixtures.js'
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

async function expectDeadline(response: Response): Promise<void> {
  expect(response.status).toBe(504)
  expect(response.headers.get('cache-control')).toBe('no-store')
  expect(apiErrorSchema.parse(await response.json()).error.code).toBe('article_deadline_exceeded')
}

describe('the Reader budget', () => {
  it('answers the deadline contract for every waiter when the publisher outlasts the budget', async () => {
    const service = await startTestService({ readerBudgetMs: 300 })
    const { user, ids } = await readingSetup(service, ['first-light'])
    const feedItemId = ids.get('first-light')
    service.upstream.stub(articleUrl('first-light'), { headers: HTML_HEADERS, body: ARTICLE_HTML, delayMs: 60_000 })

    const responses = await Promise.all([
      user.get(`/api/items/${feedItemId}/reader`),
      user.get(`/api/items/${feedItemId}/reader`),
    ])
    for (const response of responses) await expectDeadline(response)

    expect(service.upstream.requestsTo(articleUrl('first-light'))).toHaveLength(1)
    expect(service.upstream.aborted).toContain(articleUrl('first-light'))

    const trace = service.logs.find((record) => record.message === 'reader.trace')
    expect(trace).toMatchObject({ outcome: 'deadline_exceeded', feedItemId, host: 'journal.example' })
    expect(trace?.totalMs).toBeGreaterThanOrEqual(0)
    expect(trace).not.toHaveProperty('domMs')

    const item = readerItemSchema.parse(await (await user.get(`/api/items/${feedItemId}`)).json())
    expect(item.summary).toBe('A clear morning over the valley.')
  })

  it('expires an operation still queued for a retrieval slot with the same contract', async () => {
    const slots = RETRIEVAL_PROFILES.reader.capacity.maxConcurrent
    const guids = Array.from({ length: slots + 1 }, (_, index) => `item-${index}`)
    const service = await startTestService({ readerBudgetMs: 400 })
    const { user, ids } = await readingSetup(service, [...guids, 'item-after'])
    for (const guid of [...guids, 'item-after']) {
      service.upstream.stub(articleUrl(guid), { headers: HTML_HEADERS, body: ARTICLE_HTML, delayMs: 60_000 })
    }

    const responses = await Promise.all(guids.map((guid) => user.get(`/api/items/${ids.get(guid)}/reader`)))
    for (const response of responses) await expectDeadline(response)

    const traces = service.logs.filter((record) => record.message === 'reader.trace')
    expect(traces).toHaveLength(guids.length)
    for (const trace of traces) expect(trace).toMatchObject({ outcome: 'deadline_exceeded' })
    const queued = traces.filter((trace) => Number(trace.queueMs) >= 300)
    expect(queued).toHaveLength(1)
    expect(queued[0]).not.toHaveProperty('ttfbMs')

    const after = user.get(`/api/items/${ids.get('item-after')}/reader`)
    await vi.waitFor(() => expect(service.upstream.requestsTo(articleUrl('item-after'))).toHaveLength(1))
    await expectDeadline(await after)
  })

  it('expires during body receipt with the same contract', async () => {
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

    await expectDeadline(await user.get(`/api/items/${ids.get('first-light')}/reader`))

    const trace = service.logs.find((record) => record.message === 'reader.trace')
    expect(trace).toMatchObject({ outcome: 'deadline_exceeded', host: 'journal.example' })
    expect(trace?.ttfbMs).toBeGreaterThanOrEqual(0)
    expect(trace?.bodyMs).toBeGreaterThanOrEqual(0)
    expect(trace).not.toHaveProperty('domMs')
  })

  it('expires held and worker-queued extraction, replaces the worker, and answers the next request', {
    timeout: 20_000,
  }, async () => {
    const readerWorker = new ReaderWorkerFixtures()
    const service = await startTestService({ readerWorkerUrl: readerWorker.url, readerBudgetMs: 2_000 })
    const { user, ids } = await readingSetup(service, ['item-one', 'item-two'])
    service.upstream.stub(articleUrl('item-one'), { headers: HTML_HEADERS, body: ARTICLE_HTML })
    service.upstream.stub(articleUrl('item-two'), { headers: HTML_HEADERS, body: ARTICLE_HTML })
    const held = await readerWorker.holdNext()

    const active = user.get(`/api/items/${ids.get('item-one')}/reader`)
    await held.entered
    const queued = user.get(`/api/items/${ids.get('item-two')}/reader`)
    await vi.waitFor(() => expect(queuedExtractions(service.logs)).toBe(2))

    await expectDeadline(await active)
    await expectDeadline(await queued)
    await vi.waitFor(() => expect(cancelledExtractions(service.logs)).toBe(2))

    const trace = service.logs.find((record) => record.message === 'reader.trace')
    expect(trace).toMatchObject({ outcome: 'deadline_exceeded', host: 'journal.example' })
    expect(trace?.bodyMs).toBeGreaterThanOrEqual(0)

    const retried = await user.get(`/api/items/${ids.get('item-one')}/reader`)
    expect(retried.status).toBe(200)
    expect(service.upstream.requestsTo(articleUrl('item-one'))).toHaveLength(2)
  })

  it('keeps deadlines out of the five-attempt failure allowance', { timeout: 15_000 }, async () => {
    const service = await startTestService({ readerBudgetMs: 300 })
    const { user, ids } = await readingSetup(service, ['first-light'])
    const feedItemId = ids.get('first-light')
    let mode: 'slow' | 'down' = 'slow'
    service.upstream.stubDynamic(articleUrl('first-light'), () =>
      mode === 'slow'
        ? { headers: HTML_HEADERS, body: ARTICLE_HTML, delayMs: 60_000 }
        : { status: 503, headers: HTML_HEADERS, body: 'down' },
    )

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await expectDeadline(await user.get(`/api/items/${feedItemId}/reader`))
    }

    mode = 'down'
    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect((await user.get(`/api/items/${feedItemId}/reader`)).status).toBe(502)
    }
    expect((await user.get(`/api/items/${feedItemId}/reader`)).status).toBe(429)
  })
})
