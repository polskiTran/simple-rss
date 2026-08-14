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
  it('records every usable Feed without waiting on any of them answering', async () => {
    const service = await startTestService()
    const user = await claimedDevice(service)
    expect((await user.post('/api/subscriptions', { url: RSS_URL })).status).toBe(201)

    const imported = await user.post('/api/subscriptions/import', {
      opml: opmlListing([RSS_URL, ATOM_URL, 'https://down.example/feed', 'not a url']),
    })

    expect(imported.status).toBe(200)
    expect(await imported.json()).toEqual({
      added: 2,
      alreadySubscribed: 1,
      unusable: ['not a url'],
    })

    const feeds = await (await user.get('/api/feeds')).json()
    expect(feeds.subscriptions).toHaveLength(3)
  })

  it('names imported Subscriptions from the OPML until their first retrieval answers', async () => {
    const service = await startTestService()
    const user = await claimedDevice(service)

    const opml =
      '<?xml version="1.0" encoding="UTF-8"?><opml version="2.0"><body>' +
      `<outline type="rss" title="Field Notes (from OPML)" xmlUrl="${RSS_URL}"/>` +
      `<outline type="rss" xmlUrl="${ATOM_URL}"/>` +
      '</body></opml>'
    expect((await user.post('/api/subscriptions/import', { opml })).status).toBe(200)

    const feeds = await (await user.get('/api/feeds')).json()
    expect(
      feeds.subscriptions.map((subscription: { title: string; availability: { state: string } }) => [
        subscription.title,
        subscription.availability.state,
      ]),
    ).toEqual([
      ['Field Notes (from OPML)', 'unchecked'],
      ['atom.example', 'unchecked'],
    ])
  })

  it('lets the scheduler make the first retrievals, which correct titles and fill the Digest', async () => {
    const service = await startTestService()
    stubHealthyFeeds(service)
    const user = await claimedDevice(service)
    expect((await user.post('/api/subscriptions/import', { opml: opmlListing([RSS_URL, ATOM_URL]) })).status).toBe(200)

    await service.wakeScheduler()

    const feeds = await (await user.get('/api/feeds')).json()
    expect(
      feeds.subscriptions.map((subscription: { title: string; availability: { state: string } }) => [
        subscription.title,
        subscription.availability.state,
      ]),
    ).toEqual([
      ['Atom Letters', 'available'],
      ['Field Notes', 'available'],
    ])
    const digest = await (await user.get('/api/digest')).json()
    expect(digest.today.volume).toBe(2)
  })

  it('drains a bulk import in one wake even when it overflows the batch', async () => {
    const service = await startTestService({ scheduling: { batchLimit: 1, concurrency: 1 } })
    stubHealthyFeeds(service)
    const third = 'https://third.example/feed'
    service.upstream.stub(third, { headers: { 'content-type': 'application/rss+xml' }, body: RSS })
    const user = await claimedDevice(service)
    expect(
      (await user.post('/api/subscriptions/import', { opml: opmlListing([RSS_URL, ATOM_URL, third]) })).status,
    ).toBe(200)

    await service.wakeScheduler()

    const feeds = await (await user.get('/api/feeds')).json()
    expect(
      feeds.subscriptions.every(
        (subscription: { availability: { state: string } }) => subscription.availability.state === 'available',
      ),
    ).toBe(true)
  })

  it('gives imported Subscriptions the default 2-hour Polling Interval', async () => {
    const service = await startTestService()
    const user = await claimedDevice(service)

    expect((await user.post('/api/subscriptions/import', { opml: opmlListing([ATOM_URL]) })).status).toBe(200)

    expect(service.database?.prepare('SELECT polling_interval_minutes FROM subscriptions').all()).toEqual([
      { polling_interval_minutes: 120 },
    ])
  })

  it('keeps a repeated import from duplicating Subscriptions or Feed Items', async () => {
    const service = await startTestService()
    stubHealthyFeeds(service)
    const user = await claimedDevice(service)
    const opml = opmlListing([RSS_URL, ATOM_URL])

    const first = await (await user.post('/api/subscriptions/import', { opml })).json()
    expect(first).toEqual({ added: 2, alreadySubscribed: 0, unusable: [] })
    await service.wakeScheduler()

    const second = await (await user.post('/api/subscriptions/import', { opml })).json()
    expect(second).toEqual({ added: 0, alreadySubscribed: 2, unusable: [] })
    await service.wakeScheduler()
    expect(service.database?.prepare('SELECT count(*) AS count FROM subscriptions').get()).toEqual({ count: 2 })
    expect(service.database?.prepare('SELECT count(*) AS count FROM feed_items').get()).toEqual({ count: 2 })
    expect(service.upstream.requestsTo(RSS_URL)).toHaveLength(1)
    expect(service.upstream.requestsTo(ATOM_URL)).toHaveLength(1)
  })

  it('validates the upload before recording any Subscription', async () => {
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
    await service.wakeScheduler()

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
    await service.wakeScheduler()

    const exported = await (await user.get('/api/subscriptions/export')).text()
    const reimported = await (await user.post('/api/subscriptions/import', { opml: exported })).json()

    expect(reimported).toEqual({ added: 0, alreadySubscribed: 2, unusable: [] })
    expect(service.database?.prepare('SELECT count(*) AS count FROM subscriptions').get()).toEqual({ count: 2 })
  })
})
