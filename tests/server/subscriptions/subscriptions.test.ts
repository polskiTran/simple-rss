import { describe, expect, it } from 'vitest'
import { claimedDevice } from '../../support/device.js'
import { startTestService } from '../../support/service-harness.js'

const ENTERED_URL = 'https://journal.example/feed'
const RESOLVED_URL = 'https://feeds.example/journal.xml'

const RSS = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:media="http://search.yahoo.com/mrss/">
  <channel>
    <title>Field Notes</title>
    <link>https://journal.example/</link>
    <description>Notes from the field</description>
    <item>
      <guid isPermaLink="false">entry-1</guid>
      <title>First light</title>
      <link>https://journal.example/first-light#section</link>
      <pubDate>Fri, 08 Aug 2026 07:15:00 GMT</pubDate>
      <description><![CDATA[<p>A clear <strong>morning</strong>.</p><script>alert('no')</script>]]></description>
      <media:content url="https://images.example/first-light.jpg" medium="image" />
    </item>
  </channel>
</rss>`

describe('Subscriptions', () => {
  it('records a Subscription only once its Feed answers, with the Feed Window already ingested', async () => {
    const service = await startTestService()
    service.upstream
      .stub(ENTERED_URL, {
        status: 301,
        headers: { location: RESOLVED_URL, 'content-type': 'text/plain' },
      })
      .stub(RESOLVED_URL, {
        headers: { 'content-type': 'application/rss+xml; charset=utf-8' },
        body: RSS,
      })
    const user = await claimedDevice(service)

    const added = await user.post('/api/subscriptions', { url: ENTERED_URL })

    const subscription = {
      feedId: 1,
      title: 'Field Notes',
      description: 'Notes from the field',
      domain: 'journal.example',
      homePageUrl: 'https://journal.example/',
      readingSource: 'original-webpage',
      subscribedAt: '2026-08-08T09:00:00.000Z',
      enteredUrl: ENTERED_URL,
      resolvedUrl: RESOLVED_URL,
      cadence: [...Array.from({ length: 29 }, () => 0), 1],
      availability: {
        state: 'available',
        lastCheckedAt: '2026-08-08T09:00:00.000Z',
        lastSuccessDate: '2026-08-08',
        consecutiveFailures: 0,
        category: null,
      },
    }
    expect(added.status).toBe(201)
    expect(await added.json()).toEqual({ subscription })
    expect(await (await user.get('/api/feeds')).json()).toEqual({ subscriptions: [subscription] })

    const digest = await user.get('/api/digest')
    expect(await digest.json()).toEqual({
      today: '2026-08-08',
      groups: [
        {
          date: '2026-08-08',
          items: [
            {
              feedItemId: 1,
              title: 'First light',
              feedId: 1,
              feedTitle: 'Field Notes',
              link: 'https://journal.example/first-light',
              publishedAt: '2026-08-08T07:15:00.000Z',
              displayTime: '07:15',
              imageUrl: '/api/items/1/image',
              summary: 'A clear morning.',
              firstSeenAt: '2026-08-08T09:00:00.000Z',
              saved: false,
            },
          ],
          returns: [],
        },
      ],
      nextFrom: null,
    })
  })

  it('records nothing when the address does not answer with a Feed', async () => {
    const service = await startTestService()
    service.upstream
      .stub('https://journal.example/', {
        headers: { 'content-type': 'text/html' },
        body: '<!doctype html><title>Home</title>',
      })
      .stub('https://journal.example/broken', {
        headers: { 'content-type': 'application/rss+xml' },
        body: '<rss><channel>',
      })
      .stub('https://journal.example/gone', { status: 404, headers: { 'content-type': 'text/plain' } })
    const user = await claimedDevice(service)

    const refusals = [
      ['not a URL', 400, 'invalid_feed_url'],
      ['https://nowhere.example/feed', 502, 'feed_unreachable'],
      ['https://journal.example/gone', 502, 'feed_unreachable'],
      ['https://journal.example/', 415, 'unsupported_feed'],
      ['https://journal.example/broken', 422, 'malformed_feed'],
    ] as const
    for (const [url, status, code] of refusals) {
      const refused = await user.post('/api/subscriptions', { url })
      expect([url, refused.status, (await refused.json()).error.code]).toEqual([url, status, code])
    }

    for (const table of ['feeds', 'feed_url_aliases', 'subscriptions', 'feed_items']) {
      expect(service.database.$client.prepare(`SELECT count(*) AS count FROM ${table}`).get()).toEqual({ count: 0 })
    }
  })

  it('preserves the exact entered URL and answers its canonical form as a duplicate without retrieving it', async () => {
    const service = await startTestService()
    service.upstream.stub(ENTERED_URL, { headers: { 'content-type': 'application/rss+xml' }, body: RSS })
    const exact = 'https://journal.example:443/feed#user-fragment'
    const user = await claimedDevice(service)

    const added = await user.post('/api/subscriptions', { url: exact })
    expect(await added.json()).toMatchObject({
      subscription: { enteredUrl: exact, resolvedUrl: ENTERED_URL },
    })

    const duplicate = await user.post('/api/subscriptions', { url: ENTERED_URL })
    expect(duplicate.status).toBe(409)
    expect(await duplicate.json()).toMatchObject({
      error: { code: 'duplicate_subscription' },
      subscription: { feedId: 1, title: 'Field Notes' },
    })
    expect(service.upstream.requestsTo(ENTERED_URL)).toHaveLength(1)
  })

  it('answers a duplicate, writing nothing, when the address redirects to a subscribed Feed', async () => {
    const service = await startTestService()
    const alias = 'https://alias.example/feed'
    service.upstream
      .stub(ENTERED_URL, { headers: { 'content-type': 'application/rss+xml' }, body: RSS })
      .stub(alias, { status: 301, headers: { location: ENTERED_URL, 'content-type': 'text/plain' } })
    const user = await claimedDevice(service)
    expect((await user.post('/api/subscriptions', { url: ENTERED_URL })).status).toBe(201)

    const duplicate = await user.post('/api/subscriptions', { url: alias })

    expect(duplicate.status).toBe(409)
    expect(await duplicate.json()).toMatchObject({ subscription: { feedId: 1, title: 'Field Notes' } })
    expect(service.database.$client.prepare('SELECT id FROM feeds').all()).toEqual([{ id: 1 }])
    expect(service.database.$client.prepare('SELECT url FROM feed_url_aliases').all()).toEqual([{ url: ENTERED_URL }])
  })

  it('revives a retained Feed under its own row, keeping its Feed Items and Library saves', async () => {
    const service = await startTestService()
    service.upstream.stub(ENTERED_URL, { headers: { 'content-type': 'application/rss+xml' }, body: RSS })
    const user = await claimedDevice(service)
    expect((await user.post('/api/subscriptions', { url: ENTERED_URL })).status).toBe(201)
    expect((await user.put('/api/library/1')).status).toBe(200)
    expect((await user.delete('/api/feeds/1')).status).toBe(204)

    service.clock.advance(60 * 60 * 1_000)
    const revived = await user.post('/api/subscriptions', { url: ENTERED_URL })

    expect(revived.status).toBe(201)
    expect(await revived.json()).toMatchObject({
      subscription: { feedId: 1, subscribedAt: '2026-08-08T10:00:00.000Z' },
    })
    expect(service.database.$client.prepare('SELECT id, first_seen_at FROM feed_items').all()).toEqual([
      { id: 1, first_seen_at: '2026-08-08T09:00:00.000Z' },
    ])
    const library = await (await user.get('/api/library')).json()
    expect(library.items).toMatchObject([{ feedItemId: 1, feedId: 1, subscribed: true }])
  })

  it('names a Feed by its answering host when its declared site is the URL a redirect left behind', async () => {
    const service = await startTestService()
    service.upstream
      .stub(ENTERED_URL, { status: 301, headers: { location: RESOLVED_URL, 'content-type': 'text/plain' } })
      .stub(RESOLVED_URL, {
        headers: { 'content-type': 'application/rss+xml' },
        body: RSS.replace('<link>https://journal.example/</link>', `<link>${ENTERED_URL}</link>`),
      })
    const user = await claimedDevice(service)
    expect((await user.post('/api/subscriptions', { url: ENTERED_URL })).status).toBe(201)

    const feeds = await (await user.get('/api/feeds')).json()
    expect(feeds.subscriptions[0]).toMatchObject({
      title: 'Field Notes',
      domain: 'feeds.example',
      homePageUrl: null,
    })
  })

  it('merges a long-lived Feed that moved behind another Feed without touching items or saves', async () => {
    const service = await startTestService()
    const otherUrl = 'https://elsewhere.example/feed'
    service.upstream
      .stub(ENTERED_URL, { headers: { 'content-type': 'application/rss+xml' }, body: RSS })
      .stub(otherUrl, {
        headers: { 'content-type': 'application/rss+xml' },
        body: `<?xml version="1.0"?>
          <rss version="2.0"><channel><title>Elsewhere</title>
            <item><guid>kept</guid><title>Kept essay</title><pubDate>Fri, 08 Aug 2026 06:00:00 GMT</pubDate></item>
          </channel></rss>`,
      })
    const user = await claimedDevice(service)
    expect((await user.post('/api/subscriptions', { url: ENTERED_URL })).status).toBe(201)
    expect((await user.post('/api/subscriptions', { url: otherUrl })).status).toBe(201)
    const digest = await (await user.get('/api/digest')).json()
    const kept = digest.groups
      .flatMap((group: { items: { feedItemId: number; title: string }[] }) => group.items)
      .find((item: { title: string }) => item.title === 'Kept essay')
    expect((await user.put(`/api/library/${kept.feedItemId}`)).status).toBe(200)

    service.upstream.stub(otherUrl, {
      status: 301,
      headers: { location: ENTERED_URL, 'content-type': 'text/plain' },
    })
    service.clock.advance(3 * 60 * 60 * 1_000)
    await service.wakeScheduler()

    const feeds = await (await user.get('/api/feeds')).json()
    expect(feeds.subscriptions.map((subscription: { title: string }) => subscription.title)).toEqual(['Field Notes'])
    const library = await (await user.get('/api/library')).json()
    expect(library.items).toMatchObject([{ title: 'Kept essay', feedTitle: 'Elsewhere', subscribed: false }])
    expect((await user.post('/api/subscriptions', { url: otherUrl })).status).toBe(409)
  })

  it('revives a merged-away Feed kept for its saves once the Feed it merged into is retired', async () => {
    const service = await startTestService()
    const otherUrl = 'https://elsewhere.example/feed'
    service.upstream
      .stub(ENTERED_URL, { headers: { 'content-type': 'application/rss+xml' }, body: RSS })
      .stub(otherUrl, {
        headers: { 'content-type': 'application/rss+xml' },
        body: `<?xml version="1.0"?>
          <rss version="2.0"><channel><title>Elsewhere</title>
            <item><guid>kept</guid><title>Kept essay</title><pubDate>Fri, 08 Aug 2026 06:00:00 GMT</pubDate></item>
          </channel></rss>`,
      })
    const user = await claimedDevice(service)
    expect((await user.post('/api/subscriptions', { url: ENTERED_URL })).status).toBe(201)
    expect((await user.post('/api/subscriptions', { url: otherUrl })).status).toBe(201)
    const digest = await (await user.get('/api/digest')).json()
    const essay = digest.groups
      .flatMap((group: { items: { feedItemId: number; title: string }[] }) => group.items)
      .find((item: { title: string }) => item.title === 'Kept essay')
    expect((await user.put(`/api/library/${essay.feedItemId}`)).status).toBe(200)

    service.upstream.stub(otherUrl, { status: 301, headers: { location: ENTERED_URL, 'content-type': 'text/plain' } })
    service.clock.advance(3 * 60 * 60 * 1_000)
    await service.wakeScheduler()
    expect((await user.delete('/api/feeds/1')).status).toBe(204)
    await service.wakeScheduler()
    expect(service.database.$client.prepare('SELECT id FROM feeds ORDER BY id').all()).toEqual([{ id: 2 }])

    const revived = await user.post('/api/subscriptions', { url: otherUrl })
    expect(revived.status).toBe(201)
    expect(await revived.json()).toMatchObject({ subscription: { feedId: 2 } })
    expect((await user.post('/api/subscriptions', { url: otherUrl })).status).toBe(409)
    const library = await (await user.get('/api/library')).json()
    expect(library.items).toMatchObject([{ feedItemId: essay.feedItemId, feedId: 2, subscribed: true }])
  })

  it('re-ingests GUID, normalized-link, and content identities without replacing first-seen or Library state', async () => {
    const service = await startTestService()
    service.upstream.stub(ENTERED_URL, {
      headers: { 'content-type': 'application/rss+xml' },
      body: `<?xml version="1.0"?>
        <rss version="2.0"><channel><title>Corrections</title>
          <item><guid>stable</guid><title>old GUID title</title><pubDate>Fri, 08 Aug 2026 06:00:00 GMT</pubDate></item>
          <item><title>old link title</title><link>https://journal.example/shared#old</link><pubDate>Fri, 08 Aug 2026 05:00:00 GMT</pubDate></item>
          <item><title>fingerprint</title><description>same body</description><pubDate>Fri, 08 Aug 2026 04:00:00 GMT</pubDate></item>
        </channel></rss>`,
    })
    const user = await claimedDevice(service)
    expect((await user.post('/api/subscriptions', { url: ENTERED_URL })).status).toBe(201)
    service.database.$client.exec(`
      INSERT INTO library_items (feed_item_id, saved_at)
      SELECT id, '2026-08-08T09:30:00.000Z' FROM feed_items;
    `)

    service.clock.advance(60 * 60 * 1_000)
    service.upstream.stub(ENTERED_URL, {
      headers: { 'content-type': 'application/rss+xml' },
      body: `<?xml version="1.0"?>
        <rss version="2.0"><channel><title>Corrections, revised</title>
          <item><guid>stable</guid><title>corrected GUID title</title><pubDate>Fri, 08 Aug 2026 06:30:00 GMT</pubDate></item>
          <item><title>corrected link title</title><link>https://journal.example/shared#new</link><pubDate>Fri, 08 Aug 2026 05:30:00 GMT</pubDate></item>
          <item><title>fingerprint</title><description>corrected body</description><pubDate>Fri, 08 Aug 2026 04:00:00 GMT</pubDate></item>
        </channel></rss>`,
    })

    expect((await user.post('/api/feeds/1e1/refresh')).status).toBe(404)
    expect((await user.post('/api/feeds/999/refresh')).status).toBe(404)
    expect((await user.post('/api/feeds/999/refresh')).status).toBe(404)
    expect((await user.post('/api/feeds/1/refresh')).status).toBe(200)
    const requestsAfterRefresh = service.upstream.requestsTo(ENTERED_URL).length
    const limited = await user.post('/api/feeds/1/refresh')
    expect(limited.status).toBe(429)
    expect(limited.headers.get('retry-after')).toBe('60')
    expect(service.upstream.requestsTo(ENTERED_URL)).toHaveLength(requestsAfterRefresh)

    const digest = await (await user.get('/api/digest')).json()
    expect(digest.groups[0].items.map((item: { title: string }) => item.title)).toEqual([
      'corrected GUID title',
      'corrected link title',
      'fingerprint',
    ])
    expect(digest.groups[0].items[2]).toMatchObject({ title: 'fingerprint', summary: 'corrected body' })
    const persisted = service.database.$client
      .prepare('SELECT first_seen_at FROM feed_items ORDER BY id')
      .all() as Array<{
      first_seen_at: string
    }>
    expect(persisted.map((item) => item.first_seen_at)).toEqual([
      '2026-08-08T09:00:00.000Z',
      '2026-08-08T09:00:00.000Z',
      '2026-08-08T09:00:00.000Z',
    ])
    expect(service.database.$client.prepare('SELECT count(*) AS count FROM library_items').get()).toEqual({ count: 3 })
  })

  it('keeps the same entry distinct in two Feeds: identity never crosses a Feed', async () => {
    const service = await startTestService()
    const syndicated = (feedTitle: string) => `<?xml version="1.0"?>
      <rss version="2.0"><channel><title>${feedTitle}</title>
        <item>
          <guid>shared-story</guid>
          <title>Syndicated everywhere</title>
          <link>https://origin.example/story</link>
          <pubDate>Fri, 08 Aug 2026 06:00:00 GMT</pubDate>
        </item>
      </channel></rss>`
    service.upstream
      .stub('https://first.example/feed', {
        headers: { 'content-type': 'application/rss+xml' },
        body: syndicated('First Wire'),
      })
      .stub('https://second.example/feed', {
        headers: { 'content-type': 'application/rss+xml' },
        body: syndicated('Second Wire'),
      })
    const user = await claimedDevice(service)

    expect((await user.post('/api/subscriptions', { url: 'https://first.example/feed' })).status).toBe(201)
    expect((await user.post('/api/subscriptions', { url: 'https://second.example/feed' })).status).toBe(201)

    const digest = await (await user.get('/api/digest')).json()
    expect(
      digest.groups[0].items.map((item: { feedTitle: string; title: string }) => [item.feedTitle, item.title]).sort(),
    ).toEqual([
      ['First Wire', 'Syndicated everywhere'],
      ['Second Wire', 'Syndicated everywhere'],
    ])
  })
})
