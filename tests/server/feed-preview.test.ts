import { describe, expect, it, vi } from 'vitest'
import { MAX_FEED_SIZE_MIB } from '../../src/shared/api.js'
import { claimedDevice } from '../support/device.js'
import { startTestService } from '../support/service-harness.js'

const FEED_URL = 'https://journal.example/feed'

function rss(items: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Field Notes</title>
    <link>https://journal.example/</link>
    <description>Notes from the field</description>
    ${items}
  </channel>
</rss>`
}

function item(guid: string, title: string | null, pubDate: string | null): string {
  return `<item><guid>${guid}</guid>${title === null ? '' : `<title>${title}</title>`}<link>https://journal.example/${guid}</link>${
    pubDate === null ? '' : `<pubDate>${pubDate}</pubDate>`
  }</item>`
}

describe('Feed preview', () => {
  it('answers the Feed as the dialog shows it — five newest items with relative dates — and records nothing', async () => {
    const service = await startTestService()
    service.upstream.stub(FEED_URL, {
      headers: { 'content-type': 'application/rss+xml; charset=utf-8' },
      body: rss(
        [
          item('months', 'Spring thaw', 'Fri, 01 May 2026 06:00:00 GMT'),
          item('today', 'First light', 'Sat, 08 Aug 2026 07:15:00 GMT'),
          item('yesterday', null, 'Fri, 07 Aug 2026 18:00:00 GMT'),
          item('undated', 'Undated note', null),
          item('days', 'Three days on', 'Wed, 05 Aug 2026 12:00:00 GMT'),
          item('weeks', 'A fortnight back', 'Mon, 20 Jul 2026 12:00:00 GMT'),
          item('oldest', 'Midwinter', 'Thu, 01 Jan 2026 12:00:00 GMT'),
        ].join('\n'),
      ),
    })
    const user = await claimedDevice(service)

    const previewed = await user.post('/api/feeds/preview', { url: FEED_URL })

    expect(previewed.status).toBe(200)
    expect(await previewed.json()).toEqual({
      url: FEED_URL,
      title: 'Field Notes',
      description: 'Notes from the field',
      domain: 'journal.example',
      homePageUrl: 'https://journal.example/',
      items: [
        {
          title: 'First light',
          link: 'https://journal.example/today',
          publishedAt: '2026-08-08T07:15:00.000Z',
          displayDate: 'today',
        },
        {
          title: 'untitled',
          link: 'https://journal.example/yesterday',
          publishedAt: '2026-08-07T18:00:00.000Z',
          displayDate: 'yesterday',
        },
        {
          title: 'Three days on',
          link: 'https://journal.example/days',
          publishedAt: '2026-08-05T12:00:00.000Z',
          displayDate: '3 days ago',
        },
        {
          title: 'A fortnight back',
          link: 'https://journal.example/weeks',
          publishedAt: '2026-07-20T12:00:00.000Z',
          displayDate: '2 weeks ago',
        },
        {
          title: 'Spring thaw',
          link: 'https://journal.example/months',
          publishedAt: '2026-05-01T06:00:00.000Z',
          displayDate: '3 months ago',
        },
      ],
      declaredFeeds: [],
      subscribed: null,
    })
    expect(service.upstream.requests.map((request) => request.url)).toEqual([FEED_URL])
    expect(service.database?.prepare('SELECT count(*) AS count FROM feeds').get()).toEqual({ count: 0 })
    expect(await (await user.get('/api/feeds')).json()).toEqual({ subscriptions: [] })
  })

  it('puts undated items after the dated ones, in document order, and names a missing title', async () => {
    const service = await startTestService()
    service.upstream.stub(FEED_URL, {
      headers: { 'content-type': 'application/rss+xml' },
      body: rss(
        [
          item('second-undated', 'Second undated', null),
          item('dated', 'Dated', 'Sat, 08 Aug 2026 07:15:00 GMT'),
          item('first-undated', null, null),
        ].join('\n'),
      ),
    })
    const user = await claimedDevice(service)

    const previewed = await user.post('/api/feeds/preview', { url: FEED_URL })

    expect((await previewed.json()).items).toMatchObject([
      { title: 'Dated', displayDate: 'today' },
      { title: 'Second undated', publishedAt: null, displayDate: 'undated' },
      { title: 'untitled', publishedAt: null, displayDate: 'undated' },
    ])
  })

  it('answers a subscribed Feed from the store, by the Custom Title, without asking the publisher', async () => {
    const service = await startTestService()
    service.upstream.stub(FEED_URL, {
      headers: { 'content-type': 'application/rss+xml' },
      body: rss(item('today', 'First light', 'Sat, 08 Aug 2026 07:15:00 GMT')),
    })
    const user = await claimedDevice(service)
    expect((await user.post('/api/subscriptions', { url: FEED_URL })).status).toBe(201)
    expect(
      (await user.put('/api/feeds/1/details', { customTitle: 'Tech tabloid', customDescription: 'read weekly' }))
        .status,
    ).toBe(200)
    const askedBefore = service.upstream.requests.length

    const previewed = await user.post('/api/feeds/preview', { url: `${FEED_URL}#top` })

    expect(previewed.status).toBe(200)
    expect(await previewed.json()).toEqual({
      url: FEED_URL,
      title: 'Tech tabloid',
      description: 'read weekly',
      domain: 'journal.example',
      homePageUrl: 'https://journal.example/',
      items: [
        {
          title: 'First light',
          link: 'https://journal.example/today',
          publishedAt: '2026-08-08T07:15:00.000Z',
          displayDate: 'today',
        },
      ],
      declaredFeeds: [],
      subscribed: { feedId: 1 },
    })
    expect(service.upstream.requests).toHaveLength(askedBefore)
  })

  it('recognises a redirect onto a subscribed Feed after the fetch, keeping the fetched items', async () => {
    const service = await startTestService()
    service.upstream.stub(FEED_URL, {
      headers: { 'content-type': 'application/rss+xml' },
      body: rss(item('today', 'First light', 'Sat, 08 Aug 2026 07:15:00 GMT')),
    })
    const user = await claimedDevice(service)
    expect((await user.post('/api/subscriptions', { url: FEED_URL })).status).toBe(201)
    expect(
      (await user.put('/api/feeds/1/details', { customTitle: 'Tech tabloid', customDescription: null })).status,
    ).toBe(200)

    const mirrorUrl = 'https://mirror.example/feed'
    service.upstream
      .stub(mirrorUrl, { status: 301, headers: { location: FEED_URL, 'content-type': 'text/plain' } })
      .stub(FEED_URL, {
        headers: { 'content-type': 'application/rss+xml' },
        body: rss(item('second', 'Second light', 'Sat, 08 Aug 2026 08:30:00 GMT')),
      })
    const previewed = await user.post('/api/feeds/preview', { url: mirrorUrl })

    expect(previewed.status).toBe(200)
    expect(await previewed.json()).toMatchObject({
      url: mirrorUrl,
      title: 'Tech tabloid',
      description: 'Notes from the field',
      items: [{ title: 'Second light' }],
      subscribed: { feedId: 1 },
    })
    expect(service.database?.prepare('SELECT count(*) AS count FROM feed_url_aliases').get()).toEqual({ count: 1 })
    expect(service.database?.prepare('SELECT count(*) AS count FROM feed_items').get()).toEqual({ count: 1 })
  })

  it.each([
    ['http_error', 502, { status: 500, headers: { 'content-type': 'text/plain' }, body: 'gone' }],
    ['invalid_feed', 422, { headers: { 'content-type': 'application/rss+xml' }, body: 'not a feed at all' }],
    [
      'too_large',
      413,
      {
        headers: {
          'content-type': 'application/rss+xml',
          'content-length': String((MAX_FEED_SIZE_MIB + 1) * 1024 * 1024),
        },
        body: '',
      },
    ],
    ['unsupported_content', 415, { headers: { 'content-type': 'application/pdf' }, body: '%PDF-1.7' }],
    [
      'no_feed_found',
      422,
      { headers: { 'content-type': 'text/html; charset=utf-8' }, body: '<html><body>a page</body></html>' },
    ],
  ] as const)('answers %s as %i', async (code, status, response) => {
    const service = await startTestService()
    service.upstream.stub(FEED_URL, response)
    const user = await claimedDevice(service)

    const refused = await user.post('/api/feeds/preview', { url: FEED_URL })

    expect(refused.status).toBe(status)
    expect(await refused.json()).toMatchObject({ error: { code } })
    expect(service.database?.prepare('SELECT count(*) AS count FROM feeds').get()).toEqual({ count: 0 })
  })

  it('refuses an address that is not a public web address with 400', async () => {
    const service = await startTestService()
    const user = await claimedDevice(service)

    const refused = await user.post('/api/feeds/preview', { url: 'https://user:secret@journal.example/feed' })

    expect(refused.status).toBe(400)
    expect(await refused.json()).toMatchObject({ error: { code: 'invalid_feed_url' } })
    expect(service.upstream.requests).toHaveLength(0)
  })

  it('cancels the retrieval when the client gives up', async () => {
    // The torn-down connection is what the stop's grace period waits on; there is nothing to drain.
    const service = await startTestService({ env: { SHUTDOWN_GRACE_MS: '50' } })
    service.upstream.stub(FEED_URL, {
      headers: { 'content-type': 'application/rss+xml' },
      body: rss(''),
      delayMs: 10_000,
    })
    const user = await claimedDevice(service)

    const request = new AbortController()
    const previewing = user.post('/api/feeds/preview', { url: FEED_URL }, request.signal)
    await vi.waitFor(() => expect(service.upstream.requestsTo(FEED_URL)).toHaveLength(1))
    request.abort()

    await expect(previewing).rejects.toThrow()
    await vi.waitFor(() => expect(service.upstream.aborted).toContain(FEED_URL))
  })
})
