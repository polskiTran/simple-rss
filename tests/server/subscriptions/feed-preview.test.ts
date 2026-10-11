import { describe, expect, it } from 'vitest'
import { feedPreviewResponseSchema, type FeedPreviewResponse } from '../../../src/shared/api.js'
import { claimedDevice, type Device } from '../../support/device.js'
import { startTestService, type TestService } from '../../support/service-harness.js'

const PAGE_URL = 'https://journal.example/'
const FEED_URL = 'https://journal.example/feed'
const RSS_HEADERS = { 'content-type': 'application/rss+xml' }
const HTML_HEADERS = { 'content-type': 'text/html; charset=utf-8' }

const item = (title: string, pubDate?: string) => `
  <item>
    <guid>${title}</guid>
    <title>${title}</title>
    ${pubDate ? `<pubDate>${new Date(pubDate).toUTCString()}</pubDate>` : ''}
  </item>`

const rss = (title: string, ...items: string[]) => `<?xml version="1.0"?>
  <rss version="2.0"><channel><title>${title}</title><link>https://journal.example/</link>${items.join('')}</channel></rss>`

const page = (head: string) => `<!doctype html><html><head><title>Field Notes</title>${head}</head><body></body></html>`

const declares = (type: string, href: string) => `<link rel="alternate" type="${type}" href="${href}">`

async function preview(user: Device, url: string): Promise<FeedPreviewResponse> {
  const response = await user.post('/api/subscriptions/preview', { url })
  expect(response.status).toBe(200)
  return feedPreviewResponseSchema.parse(await response.json())
}

function declaredFeedTitles(answer: FeedPreviewResponse): string[] {
  return answer.kind === 'page' ? answer.feeds.map((feed) => feed.title) : []
}

function storedRows(service: TestService): unknown[] {
  return ['feeds', 'feed_url_aliases', 'subscriptions', 'feed_items'].map((table) =>
    service.database.$client.prepare(`SELECT * FROM ${table}`).all(),
  )
}

describe('Feed preview', () => {
  it('summarises a Feed: newest Feed Items first, five at most, and its Cadence by the stored chronology', async () => {
    const service = await startTestService()
    service.upstream.stub(FEED_URL, {
      headers: RSS_HEADERS,
      body: rss(
        'Field Notes',
        item('Older', '2026-07-01T08:00:00Z'),
        item('Last week', '2026-08-01T08:00:00Z'),
        item('Two days ago', '2026-08-06T08:00:00Z'),
        item('Yesterday', '2026-08-07T12:00:00Z'),
        item('This morning', '2026-08-08T07:00:00Z'),
        item('Undated'),
        item('Tonight', '2026-08-08T21:00:00Z'),
        item('Far future', '2026-09-01T00:00:00Z'),
      ),
    })
    const user = await claimedDevice(service)

    expect(await preview(user, FEED_URL)).toEqual({
      kind: 'feed',
      feed: {
        feedUrl: FEED_URL,
        title: 'Field Notes',
        domain: 'journal.example',
        homePageUrl: 'https://journal.example/',
        cadence: [...Array.from({ length: 22 }, () => 0), 1, 0, 0, 0, 0, 1, 1, 4],
        lastItemAt: '2026-08-08T21:00:00.000Z',
        items: [
          { title: 'Tonight', publishedAt: '2026-08-08T21:00:00.000Z' },
          { title: 'Far future', publishedAt: '2026-09-01T00:00:00.000Z' },
          { title: 'Undated', publishedAt: null },
          { title: 'This morning', publishedAt: '2026-08-08T07:00:00.000Z' },
          { title: 'Yesterday', publishedAt: '2026-08-07T12:00:00.000Z' },
        ],
        subscribed: false,
      },
    })
  })

  it('previews a Feed served as a web page as the Feed it is', async () => {
    const service = await startTestService()
    service.upstream.stub(FEED_URL, { headers: HTML_HEADERS, body: rss('Field Notes') })
    const user = await claimedDevice(service)

    expect(await preview(user, FEED_URL)).toMatchObject({ kind: 'feed', feed: { title: 'Field Notes' } })
  })

  it("reads a page's Declared Feeds in page order, resolving addresses against its base", async () => {
    const service = await startTestService()
    service.upstream
      .stub(PAGE_URL, {
        headers: HTML_HEADERS,
        body: page(
          '<base href="https://journal.example/blog/">' +
            declares('application/atom+xml', 'atom.xml') +
            '<link rel="alternate" hreflang="fr" type="text/html" href="/fr/">' +
            '<link rel="stylesheet" type="application/rss+xml" href="/styles">' +
            declares('application/rss+xml', '/feed') +
            declares('application/rss+xml', 'https://journal.example/feed#latest'),
        ),
      })
      .stub('https://journal.example/blog/atom.xml', {
        headers: { 'content-type': 'application/atom+xml' },
        body: `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><title>Atom Letters</title></feed>`,
      })
      .stub(FEED_URL, { headers: RSS_HEADERS, body: rss('Field Notes') })
    const user = await claimedDevice(service)

    const answer = await preview(user, PAGE_URL)

    expect(answer).toMatchObject({
      kind: 'page',
      host: 'journal.example',
      feeds: [
        { feedUrl: 'https://journal.example/blog/atom.xml', title: 'Atom Letters' },
        { feedUrl: FEED_URL, title: 'Field Notes' },
      ],
    })
    expect(service.upstream.requests.map((request) => request.url)).not.toContain('https://journal.example/fr/')
  })

  it('retrieves only the first five Declared Feeds', async () => {
    const service = await startTestService()
    const feedUrls = Array.from({ length: 6 }, (_, index) => `https://journal.example/feed-${index + 1}`)
    service.upstream.stub(PAGE_URL, {
      headers: HTML_HEADERS,
      body: page(feedUrls.map((url) => declares('application/rss+xml', url)).join('')),
    })
    for (const [index, url] of feedUrls.entries()) {
      service.upstream.stub(url, { headers: RSS_HEADERS, body: rss(`Feed ${index + 1}`) })
    }
    const user = await claimedDevice(service)

    expect(declaredFeedTitles(await preview(user, PAGE_URL))).toEqual([
      'Feed 1',
      'Feed 2',
      'Feed 3',
      'Feed 4',
      'Feed 5',
    ])
    expect(service.upstream.requestsTo('https://journal.example/feed-6')).toHaveLength(0)
  })

  it('leaves out a Declared Feed that answers with another page, never following it', async () => {
    const service = await startTestService()
    const elsewhere = 'https://journal.example/elsewhere'
    service.upstream
      .stub(PAGE_URL, {
        headers: HTML_HEADERS,
        body: page(declares('application/rss+xml', elsewhere) + declares('application/rss+xml', FEED_URL)),
      })
      .stub(elsewhere, {
        headers: HTML_HEADERS,
        body: page(declares('application/rss+xml', 'https://journal.example/deeper')),
      })
      .stub(FEED_URL, { headers: RSS_HEADERS, body: rss('Field Notes') })
    const user = await claimedDevice(service)

    expect(declaredFeedTitles(await preview(user, PAGE_URL))).toEqual(['Field Notes'])
    expect(service.upstream.requestsTo('https://journal.example/deeper')).toHaveLength(0)
  })

  it('answers a page that declares no Feed with an empty list', async () => {
    const service = await startTestService()
    service.upstream.stub(PAGE_URL, { headers: HTML_HEADERS, body: page('') })
    const user = await claimedDevice(service)

    expect(await preview(user, PAGE_URL)).toEqual({ kind: 'page', host: 'journal.example', feeds: [] })
  })

  it('answers with the first failure when every Declared Feed fails, and refuses what is not an address', async () => {
    const service = await startTestService()
    service.upstream
      .stub(PAGE_URL, {
        headers: HTML_HEADERS,
        body: page(declares('application/rss+xml', '/gone') + declares('application/rss+xml', '/broken')),
      })
      .stub('https://journal.example/gone', { status: 404, headers: { 'content-type': 'text/plain' } })
      .stub('https://journal.example/broken', { headers: RSS_HEADERS, body: '<rss><channel>' })
    const user = await claimedDevice(service)

    const failed = await user.post('/api/subscriptions/preview', { url: PAGE_URL })
    expect(failed.status).toBe(502)
    expect(await failed.json()).toMatchObject({ error: { code: 'feed_unreachable' } })

    const invalid = await user.post('/api/subscriptions/preview', { url: 'not a URL' })
    expect(invalid.status).toBe(400)
    expect(await invalid.json()).toMatchObject({ error: { code: 'invalid_feed_url' } })
  })

  it('says a Feed is subscribed whether reached by its own address or through a redirect', async () => {
    const service = await startTestService()
    const moved = 'https://old.example/feed'
    service.upstream
      .stub(FEED_URL, { headers: RSS_HEADERS, body: rss('Field Notes') })
      .stub(moved, { status: 301, headers: { location: FEED_URL, 'content-type': 'text/plain' } })
      .stub(PAGE_URL, { headers: HTML_HEADERS, body: page(declares('application/rss+xml', moved)) })
    const user = await claimedDevice(service)
    expect((await user.post('/api/subscriptions', { url: FEED_URL })).status).toBe(201)

    expect(await preview(user, FEED_URL)).toMatchObject({ feed: { subscribed: true } })
    expect(await preview(user, moved)).toMatchObject({ feed: { feedUrl: moved, subscribed: true } })
    expect(await preview(user, PAGE_URL)).toMatchObject({ feeds: [{ feedUrl: moved, subscribed: true }] })
  })

  it('records nothing, whatever it previews', async () => {
    const service = await startTestService()
    const other = 'https://other.example/feed'
    service.upstream
      .stub(FEED_URL, { headers: RSS_HEADERS, body: rss('Field Notes', item('This morning', '2026-08-08T07:00:00Z')) })
      .stub(other, { headers: RSS_HEADERS, body: rss('Other Notes', item('Elsewhere', '2026-08-08T06:00:00Z')) })
      .stub(PAGE_URL, { headers: HTML_HEADERS, body: page(declares('application/rss+xml', other)) })
    const user = await claimedDevice(service)
    expect((await user.post('/api/subscriptions', { url: FEED_URL })).status).toBe(201)
    const before = storedRows(service)

    await preview(user, FEED_URL)
    await preview(user, other)
    await preview(user, PAGE_URL)

    expect(storedRows(service)).toEqual(before)
  })
})
