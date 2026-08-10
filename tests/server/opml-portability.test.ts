import { describe, expect, it } from 'vitest'
import { MAX_OPML_FEEDS } from '../../src/server/subscriptions/opml.js'
import { Device, claimedDevice } from '../support/device.js'
import { startTestService, type TestService } from '../support/service-harness.js'

const RSS_URL = 'https://journal.example/feed'
const ATOM_URL = 'https://atom.example/feed.xml'

const RSS = `<?xml version="1.0"?>
  <rss version="2.0"><channel><title>Field Notes</title>
    <item><guid>entry-1</guid><title>First light</title><pubDate>Fri, 08 Aug 2026 07:15:00 GMT</pubDate></item>
  </channel></rss>`

const ATOM = `<?xml version="1.0"?>
  <feed xmlns="http://www.w3.org/2005/Atom">
    <title>Atom Letters</title>
    <entry><id>tag:atom.example,2026:one</id><title>One letter</title><published>2026-08-08T06:00:00Z</published></entry>
  </feed>`

function opmlListing(urls: readonly string[]): string {
  const outlines = urls.map((url) => `<outline type="rss" xmlUrl="${url}"/>`).join('')
  return `<?xml version="1.0" encoding="UTF-8"?><opml version="2.0"><body>${outlines}</body></opml>`
}

function stubHealthyFeeds(service: TestService): void {
  service.upstream
    .stub(RSS_URL, { headers: { 'content-type': 'application/rss+xml' }, body: RSS })
    .stub(ATOM_URL, { headers: { 'content-type': 'application/atom+xml' }, body: ATOM })
}

describe('OPML import', () => {
  it('processes each Feed independently and reports added, skipped, and failed', async () => {
    const service = await startTestService()
    stubHealthyFeeds(service)
    service.upstream
      .stub('https://down.example/feed', { status: 503 })
      .stub('https://broken.example/feed', {
        headers: { 'content-type': 'application/rss+xml' },
        body: '<rss><channel>',
      })
    const user = await claimedDevice(service)
    expect((await user.post('/api/subscriptions', { url: RSS_URL })).status).toBe(201)

    const imported = await user.post('/api/subscriptions/import', {
      opml: opmlListing([RSS_URL, ATOM_URL, 'https://down.example/feed', 'https://broken.example/feed', 'not a url']),
    })

    expect(imported.status).toBe(200)
    expect(await imported.json()).toEqual({
      feeds: [
        { url: RSS_URL, outcome: 'skipped', title: 'Field Notes', reason: 'already subscribed' },
        { url: ATOM_URL, outcome: 'added', title: 'Atom Letters', reason: null },
        {
          url: 'https://down.example/feed',
          outcome: 'failed',
          title: null,
          reason: 'The Feed could not be reached',
        },
        {
          url: 'https://broken.example/feed',
          outcome: 'failed',
          title: null,
          reason: 'The Feed returned malformed XML',
        },
        {
          url: 'not a url',
          outcome: 'failed',
          title: null,
          reason: 'Enter an exact HTTP or HTTPS Feed URL',
        },
      ],
    })

    const feeds = await (await user.get('/api/feeds')).json()
    expect(feeds.subscriptions.map((subscription: { title: string }) => subscription.title)).toEqual([
      'Atom Letters',
      'Field Notes',
    ])
  })

  it('gives imported Subscriptions the default 2-hour Polling Interval', async () => {
    const service = await startTestService()
    stubHealthyFeeds(service)
    const user = await claimedDevice(service)

    expect((await user.post('/api/subscriptions/import', { opml: opmlListing([ATOM_URL]) })).status).toBe(200)

    expect(
      service.database?.prepare('SELECT polling_interval_minutes FROM subscriptions').all(),
    ).toEqual([{ polling_interval_minutes: 120 }])
  })

  it('keeps a repeated import from duplicating Subscriptions or Feed Items', async () => {
    const service = await startTestService()
    stubHealthyFeeds(service)
    const user = await claimedDevice(service)
    const opml = opmlListing([RSS_URL, ATOM_URL])

    const first = await (await user.post('/api/subscriptions/import', { opml })).json()
    expect(first.feeds.map((feed: { outcome: string }) => feed.outcome)).toEqual(['added', 'added'])

    const second = await (await user.post('/api/subscriptions/import', { opml })).json()
    expect(second.feeds).toEqual([
      { url: RSS_URL, outcome: 'skipped', title: 'Field Notes', reason: 'already subscribed' },
      { url: ATOM_URL, outcome: 'skipped', title: 'Atom Letters', reason: 'already subscribed' },
    ])
    expect(service.database?.prepare('SELECT count(*) AS count FROM subscriptions').get()).toEqual({ count: 2 })
    expect(service.database?.prepare('SELECT count(*) AS count FROM feed_items').get()).toEqual({ count: 2 })
    // The skipped Feeds were never retrieved a second time.
    expect(service.upstream.requestsTo(RSS_URL)).toHaveLength(1)
    expect(service.upstream.requestsTo(ATOM_URL)).toHaveLength(1)
  })

  it('validates the upload before touching any Feed', async () => {
    const service = await startTestService()
    const user = await claimedDevice(service)

    const notXml = await user.post('/api/subscriptions/import', { opml: '<opml><body><outline' })
    expect(notXml.status).toBe(422)
    expect(await notXml.json()).toMatchObject({ error: { code: 'malformed_opml' } })

    const notOpml = await user.post('/api/subscriptions/import', { opml: '<rss version="2.0"/>' })
    expect(notOpml.status).toBe(422)
    expect(await notOpml.json()).toMatchObject({ error: { code: 'unsupported_opml' } })

    const urls = Array.from({ length: MAX_OPML_FEEDS + 1 }, (_, index) => `https://feeds.example/${index}`)
    const oversized = await user.post('/api/subscriptions/import', { opml: opmlListing(urls) })
    expect(oversized.status).toBe(413)
    expect(await oversized.json()).toMatchObject({ error: { code: 'too_many_feeds' } })

    const wrongShape = await user.post('/api/subscriptions/import', { file: 'nope' })
    expect(wrongShape.status).toBe(400)

    expect(service.upstream.requests).toHaveLength(0)
    expect(await (await user.get('/api/feeds')).json()).toEqual({ subscriptions: [] })
  })

  it('is closed to anyone but the User', async () => {
    const service = await startTestService()
    await claimedDevice(service)
    const stranger = new Device(service)

    expect((await stranger.post('/api/subscriptions/import', { opml: opmlListing([RSS_URL]) })).status).toBe(401)
    expect((await stranger.get('/api/subscriptions/export')).status).toBe(401)
  })
})

describe('OPML export', () => {
  it('answers with a portable OPML document holding every active Subscription', async () => {
    const service = await startTestService()
    stubHealthyFeeds(service)
    const user = await claimedDevice(service)
    expect((await user.post('/api/subscriptions/import', { opml: opmlListing([RSS_URL, ATOM_URL]) })).status).toBe(200)

    const exported = await user.get('/api/subscriptions/export')

    expect(exported.status).toBe(200)
    expect(exported.headers.get('content-type')).toBe('text/x-opml; charset=utf-8')
    expect(exported.headers.get('content-disposition')).toBe('attachment; filename="subscriptions.opml"')
    expect(exported.headers.get('cache-control')).toBe('no-store')
    const body = await exported.text()
    expect(body).toContain('<opml version="2.0">')
    expect(body).toContain(`<outline type="rss" text="Atom Letters" title="Atom Letters" xmlUrl="${ATOM_URL}"/>`)
    expect(body).toContain(`<outline type="rss" text="Field Notes" title="Field Notes" xmlUrl="${RSS_URL}"/>`)
  })

  it('round trips: importing its own export changes nothing', async () => {
    const service = await startTestService()
    stubHealthyFeeds(service)
    const user = await claimedDevice(service)
    expect((await user.post('/api/subscriptions/import', { opml: opmlListing([RSS_URL, ATOM_URL]) })).status).toBe(200)

    const exported = await (await user.get('/api/subscriptions/export')).text()
    const reimported = await (await user.post('/api/subscriptions/import', { opml: exported })).json()

    expect(reimported.feeds.map((feed: { outcome: string }) => feed.outcome)).toEqual(['skipped', 'skipped'])
    expect(service.database?.prepare('SELECT count(*) AS count FROM subscriptions').get()).toEqual({ count: 2 })
  })
})
