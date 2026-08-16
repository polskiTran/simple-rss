import { describe, expect, it } from 'vitest'
import { claimedDevice } from '../support/device.js'
import { startTestService } from '../support/service-harness.js'

const FEED_URL = 'https://journal.example/feed'
const FEED_HEADERS = { 'content-type': 'application/rss+xml' }

const rss = (description: string | null) => `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Field Notes</title>
    <link>https://journal.example/</link>
    ${description === null ? '' : `<description>${description}</description>`}
    <item>
      <guid>entry-1</guid>
      <title>First light</title>
      <pubDate>Fri, 08 Aug 2026 07:15:00 GMT</pubDate>
    </item>
  </channel>
</rss>`

const ATOM = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Atom Letters</title>
  <subtitle type="html">Letters &lt;em&gt;about&lt;/em&gt; type</subtitle>
  <entry><id>tag:atom.example,2026:one</id><title>One letter</title><published>2026-08-08T06:00:00Z</published></entry>
</feed>`

const RDF = `<?xml version="1.0" encoding="UTF-8"?>
<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns="http://purl.org/rss/1.0/">
  <channel rdf:about="https://rdf.example/feed">
    <title>Old Wire</title>
    <link>https://rdf.example/</link>
    <description>Headlines the RDF way</description>
  </channel>
  <item rdf:about="https://rdf.example/one"><title>One wire</title><link>https://rdf.example/one</link></item>
</rdf:RDF>`

describe('Feed Description', () => {
  it('stores each format’s channel description as plain text and exposes it on list and detail', async () => {
    const service = await startTestService()
    service.upstream
      .stub(FEED_URL, {
        headers: FEED_HEADERS,
        body: rss('<![CDATA[Notes <em>from</em> the field]]>'),
      })
      .stub('https://atom.example/feed.xml', { headers: { 'content-type': 'application/atom+xml' }, body: ATOM })
      .stub('https://rdf.example/feed', { headers: FEED_HEADERS, body: RDF })
    const user = await claimedDevice(service)
    for (const url of [FEED_URL, 'https://atom.example/feed.xml', 'https://rdf.example/feed']) {
      expect((await user.post('/api/subscriptions', { url })).status).toBe(201)
    }
    await service.wakeScheduler()

    const feeds = await (await user.get('/api/feeds')).json()
    expect(
      feeds.subscriptions.map((subscription: { title: string; description: string | null }) => [
        subscription.title,
        subscription.description,
      ]),
    ).toEqual([
      ['Atom Letters', 'Letters about type'],
      ['Field Notes', 'Notes from the field'],
      ['Old Wire', 'Headlines the RDF way'],
    ])

    const detail = await (await user.get('/api/feeds/1')).json()
    expect(detail).toMatchObject({ title: 'Field Notes', description: 'Notes from the field' })
  })

  it('bounds an oversized description to 1024 characters of plain text', async () => {
    const service = await startTestService()
    service.upstream.stub(FEED_URL, { headers: FEED_HEADERS, body: rss('word '.repeat(400)) })
    const user = await claimedDevice(service)
    expect((await user.post('/api/subscriptions', { url: FEED_URL })).status).toBe(201)
    await service.wakeScheduler()

    const detail = await (await user.get('/api/feeds/1')).json()
    expect(detail.description).toHaveLength(1024)
    expect(detail.description.startsWith('word word')).toBe(true)
  })

  it('refreshes on a changed document, stays put on a 304, and follows the element out of the document', async () => {
    const service = await startTestService()
    let body = rss('First words')
    let status = 200
    service.upstream.stubDynamic(FEED_URL, () =>
      status === 304 ? { status, headers: { etag: '"v1"' } } : { headers: { ...FEED_HEADERS, etag: '"v1"' }, body },
    )
    const user = await claimedDevice(service)
    expect((await user.post('/api/subscriptions', { url: FEED_URL })).status).toBe(201)
    await service.wakeScheduler()
    expect((await (await user.get('/api/feeds/1')).json()).description).toBe('First words')

    status = 304
    service.clock.advance(3 * 60 * 60 * 1_000)
    await service.wakeScheduler()
    expect((await (await user.get('/api/feeds/1')).json()).description).toBe('First words')

    status = 200
    body = rss('Second words')
    service.clock.advance(3 * 60 * 60 * 1_000)
    await service.wakeScheduler()
    expect((await (await user.get('/api/feeds/1')).json()).description).toBe('Second words')

    body = rss(null)
    service.clock.advance(3 * 60 * 60 * 1_000)
    await service.wakeScheduler()
    expect((await (await user.get('/api/feeds/1')).json()).description).toBeNull()
  })

  it('leaves the description absent for a document that never declares one', async () => {
    const service = await startTestService()
    service.upstream.stub(FEED_URL, { headers: FEED_HEADERS, body: rss(null) })
    const user = await claimedDevice(service)
    expect((await user.post('/api/subscriptions', { url: FEED_URL })).status).toBe(201)
    await service.wakeScheduler()

    const detail = await (await user.get('/api/feeds/1')).json()
    expect(detail.description).toBeNull()
  })

  it('carries the description into OPML export as the standard outline attribute', async () => {
    const service = await startTestService()
    service.upstream.stub(FEED_URL, { headers: FEED_HEADERS, body: rss('Notes from the field') })
    const user = await claimedDevice(service)
    expect((await user.post('/api/subscriptions', { url: FEED_URL })).status).toBe(201)
    await service.wakeScheduler()

    const body = await (await user.get('/api/subscriptions/export')).text()
    expect(body).toContain(
      `<outline type="rss" text="Field Notes" title="Field Notes" description="Notes from the field" xmlUrl="${FEED_URL}"/>`,
    )
  })
})
