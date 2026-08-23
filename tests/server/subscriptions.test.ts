import { describe, expect, it, vi } from 'vitest'
import { claimedDevice } from '../support/device.js'
import { startTestService } from '../support/service-harness.js'
import { STUBBED_HOST_ADDRESS } from '../support/upstream-fixtures.js'

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
  it('records the Subscription unchecked; the scheduler makes the first retrieval', async () => {
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

    expect(added.status).toBe(201)
    expect(await added.json()).toEqual({
      subscription: {
        feedId: 1,
        title: 'journal.example',
        description: null,
        domain: 'journal.example',
        homePageUrl: null,
        enteredUrl: ENTERED_URL,
        resolvedUrl: ENTERED_URL,
        cadence: Array.from({ length: 30 }, () => 0),
        availability: {
          state: 'unchecked',
          lastCheckedAt: null,
          lastSuccessAt: null,
          consecutiveFailures: 0,
          category: null,
        },
      },
    })
    expect(service.logs).toContainEqual(
      expect.objectContaining({
        message: 'subscriptions.subscription_created',
        enteredUrl: ENTERED_URL,
      }),
    )

    await service.wakeScheduler()

    const feeds = await user.get('/api/feeds')
    expect(feeds.status).toBe(200)
    expect(await feeds.json()).toEqual({
      subscriptions: [
        {
          feedId: 1,
          title: 'Field Notes',
          description: 'Notes from the field',
          domain: 'journal.example',
          homePageUrl: 'https://journal.example/',
          enteredUrl: ENTERED_URL,
          resolvedUrl: RESOLVED_URL,
          cadence: [...Array.from({ length: 29 }, () => 0), 1],
          availability: {
            state: 'available',
            lastCheckedAt: '2026-08-08T09:00:00.000Z',
            lastSuccessAt: '2026-08-08T09:00:00.000Z',
            consecutiveFailures: 0,
            category: null,
          },
        },
      ],
    })

    const digest = await user.get('/api/digest')
    expect(digest.status).toBe(200)
    expect(await digest.json()).toEqual({
      today: { date: '2026-08-08', volume: 1 },
      groups: [
        {
          date: '2026-08-08',
          label: 'today',
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
        },
      ],
      nextCursor: null,
    })
  })

  it('nudges the scheduler, so the first retrieval lands without waiting for a wake', async () => {
    const service = await startTestService({ scheduling: { nudges: true } })
    service.upstream.stub(ENTERED_URL, {
      headers: { 'content-type': 'application/rss+xml' },
      body: RSS,
    })
    const user = await claimedDevice(service)

    expect((await user.post('/api/subscriptions', { url: ENTERED_URL })).status).toBe(201)

    await vi.waitFor(async () => {
      const feeds = await (await user.get('/api/feeds')).json()
      expect(feeds.subscriptions[0]).toMatchObject({
        title: 'Field Notes',
        availability: expect.objectContaining({ state: 'available' }),
      })
    })
  })

  it('falls back to the answering host for a Feed that declares only its own URL as its site', async () => {
    const service = await startTestService()
    service.upstream
      .stub(ENTERED_URL, { status: 301, headers: { location: RESOLVED_URL, 'content-type': 'text/plain' } })
      .stub(RESOLVED_URL, {
        headers: { 'content-type': 'application/rss+xml' },
        body: RSS.replace('<link>https://journal.example/</link>', `<link>${RESOLVED_URL}</link>`),
      })
    const user = await claimedDevice(service)
    expect((await user.post('/api/subscriptions', { url: ENTERED_URL })).status).toBe(201)

    await service.wakeScheduler()

    const feeds = await (await user.get('/api/feeds')).json()
    expect(feeds.subscriptions[0]).toMatchObject({
      title: 'Field Notes',
      domain: 'feeds.example',
      homePageUrl: null,
    })
  })

  it('falls back to the answering host for a Feed that declares the URL its redirect left behind', async () => {
    const service = await startTestService()
    service.upstream
      .stub(ENTERED_URL, { status: 301, headers: { location: RESOLVED_URL, 'content-type': 'text/plain' } })
      .stub(RESOLVED_URL, {
        headers: { 'content-type': 'application/rss+xml' },
        body: RSS.replace('<link>https://journal.example/</link>', `<link>${ENTERED_URL}</link>`),
      })
    const user = await claimedDevice(service)
    expect((await user.post('/api/subscriptions', { url: ENTERED_URL })).status).toBe(201)

    await service.wakeScheduler()

    const feeds = await (await user.get('/api/feeds')).json()
    expect(feeds.subscriptions[0]).toMatchObject({
      title: 'Field Notes',
      domain: 'feeds.example',
      homePageUrl: null,
    })
  })

  it('resolves each host exactly once across the redirect its first retrieval follows', async () => {
    const service = await startTestService()
    service.upstream
      .stub(ENTERED_URL, { status: 301, headers: { location: RESOLVED_URL, 'content-type': 'text/plain' } })
      .stub(RESOLVED_URL, { headers: { 'content-type': 'application/rss+xml' }, body: RSS })
    const user = await claimedDevice(service)
    expect((await user.post('/api/subscriptions', { url: ENTERED_URL })).status).toBe(201)

    await service.wakeScheduler()

    expect(service.upstream.resolutions).toEqual(['journal.example', 'feeds.example'])
    expect(service.upstream.requests.map((request) => request.addresses)).toEqual([
      [STUBBED_HOST_ADDRESS],
      [STUBBED_HOST_ADDRESS],
    ])
  })

  it('preserves the exact entered URL and dedupes on its canonical form', async () => {
    const service = await startTestService()
    const exact = 'https://journal.example:443/feed#user-fragment'
    const user = await claimedDevice(service)

    const added = await user.post('/api/subscriptions', { url: exact })
    expect(await added.json()).toMatchObject({
      subscription: { enteredUrl: exact, resolvedUrl: ENTERED_URL },
    })

    expect((await user.post('/api/subscriptions', { url: ENTERED_URL })).status).toBe(409)
    expect((await (await user.get('/api/feeds')).json()).subscriptions).toHaveLength(1)
  })

  it('quietly merges a Subscription whose first retrieval reveals an already-subscribed Feed', async () => {
    const service = await startTestService()
    service.upstream.stub(ENTERED_URL, {
      headers: { 'content-type': 'application/rss+xml' },
      body: RSS,
    })
    const user = await claimedDevice(service)
    expect((await user.post('/api/subscriptions', { url: ENTERED_URL })).status).toBe(201)
    await service.wakeScheduler()

    const alias = 'https://alias.example/feed'
    service.upstream.stub(alias, {
      status: 301,
      headers: { location: ENTERED_URL, 'content-type': 'text/plain' },
    })
    expect((await user.post('/api/subscriptions', { url: alias })).status).toBe(201)
    await service.wakeScheduler()

    const feeds = await (await user.get('/api/feeds')).json()
    expect(feeds.subscriptions).toHaveLength(1)
    expect(feeds.subscriptions[0]).toMatchObject({
      title: 'Field Notes',
      availability: expect.objectContaining({ state: 'available' }),
    })
    expect((await user.post('/api/subscriptions', { url: alias })).status).toBe(409)
    expect(service.logs).toContainEqual(
      expect.objectContaining({ message: 'subscriptions.feeds_merged', feedId: 2, intoFeedId: 1 }),
    )
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
    await service.wakeScheduler()
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

  it('refuses only what recording itself can see: a URL that is not a Feed endpoint', async () => {
    const service = await startTestService()
    const user = await claimedDevice(service)

    const invalid = await user.post('/api/subscriptions', { url: 'not a URL' })
    expect(invalid.status).toBe(400)
    expect(await invalid.json()).toMatchObject({ error: { code: 'invalid_feed_url' } })
    expect(await (await user.get('/api/feeds')).json()).toEqual({ subscriptions: [] })

    service.upstream.stub(ENTERED_URL, {
      headers: { 'content-type': 'application/rss+xml' },
      body: RSS,
    })
    expect((await user.post('/api/subscriptions', { url: ENTERED_URL })).status).toBe(201)
    expect((await user.post('/api/subscriptions', { url: ENTERED_URL })).status).toBe(409)
    await service.wakeScheduler()
    expect(service.upstream.requestsTo(ENTERED_URL)).toHaveLength(1)
    expect((await (await user.get('/api/feeds')).json()).subscriptions).toHaveLength(1)
  })

  it('answers a Feed that never answers with unchecked turning unavailable, never an error', async () => {
    const service = await startTestService()
    const user = await claimedDevice(service)

    expect((await user.post('/api/subscriptions', { url: 'https://nowhere.example/feed' })).status).toBe(201)

    await service.wakeScheduler()
    let feeds = await (await user.get('/api/feeds')).json()
    expect(feeds.subscriptions[0].availability).toMatchObject({
      state: 'unchecked',
      consecutiveFailures: 1,
      category: 'unreachable',
    })

    for (let failures = 2; failures <= 3; failures += 1) {
      service.clock.advance(24 * 60 * 60 * 1_000)
      await service.wakeScheduler()
    }
    feeds = await (await user.get('/api/feeds')).json()
    expect(feeds.subscriptions[0].availability).toMatchObject({
      state: 'unavailable',
      consecutiveFailures: 3,
      lastSuccessAt: null,
    })
  })

  it('keeps a Subscription whose first persistence failed, and the next wake retries it', async () => {
    const service = await startTestService()
    service.upstream.stub(ENTERED_URL, {
      headers: { 'content-type': 'application/rss+xml' },
      body: RSS,
    })
    service.database?.exec(`
      CREATE TRIGGER reject_feed_item
      BEFORE INSERT ON feed_items
      BEGIN
        SELECT RAISE(ABORT, 'fixture failure');
      END;
    `)
    const user = await claimedDevice(service)

    expect((await user.post('/api/subscriptions', { url: ENTERED_URL })).status).toBe(201)
    await service.wakeScheduler()

    expect(await (await user.get('/api/digest')).json()).toMatchObject({ today: { volume: 0 } })
    service.database?.exec('DROP TRIGGER reject_feed_item')
    service.clock.advance(60_000)
    await service.wakeScheduler()

    expect(await (await user.get('/api/digest')).json()).toMatchObject({ today: { volume: 1 } })
    const feeds = await (await user.get('/api/feeds')).json()
    expect(feeds.subscriptions[0].availability).toMatchObject({ state: 'available' })
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
    await service.wakeScheduler()
    service.database?.exec(`
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
    const persisted = service.database?.prepare('SELECT first_seen_at FROM feed_items ORDER BY id').all() as Array<{
      first_seen_at: string
    }>
    expect(persisted.map((item) => item.first_seen_at)).toEqual([
      '2026-08-08T09:00:00.000Z',
      '2026-08-08T09:00:00.000Z',
      '2026-08-08T09:00:00.000Z',
    ])
    expect(service.database?.prepare('SELECT count(*) AS count FROM library_items').get()).toEqual({ count: 3 })
  })

  it('accepts Atom and normalizes its accepted content shape', async () => {
    const service = await startTestService()
    const atomUrl = 'https://atom.example/feed.xml'
    service.upstream.stub(atomUrl, {
      headers: { 'content-type': 'application/atom+xml' },
      body: `<?xml version="1.0"?>
        <feed xmlns="http://www.w3.org/2005/Atom">
          <title>Atom Letters</title>
          <entry>
            <id>tag:atom.example,2026:one</id>
            <title type="xhtml"><div xmlns="http://www.w3.org/1999/xhtml">One <em>letter</em></div></title>
            <updated>2026-08-07T20:00:00Z</updated>
            <link rel="alternate" href="/letters/one#top" />
            <summary type="xhtml"><div xmlns="http://www.w3.org/1999/xhtml"><p>Kept as <em>plain text</em>.</p></div></summary>
          </entry>
        </feed>`,
    })
    const user = await claimedDevice(service)

    expect((await user.post('/api/subscriptions', { url: atomUrl })).status).toBe(201)
    await service.wakeScheduler()
    const digest = await (await user.get('/api/digest')).json()

    expect(digest.groups[0]).toMatchObject({
      date: '2026-08-07',
      label: 'yesterday',
      items: [
        {
          title: 'One letter',
          link: 'https://atom.example/letters/one',
          summary: 'Kept as plain text.',
        },
      ],
    })
  })

  it('corrects an Atom entry under its Atom ID exactly as RSS GUIDs are corrected', async () => {
    const service = await startTestService()
    const atomUrl = 'https://atom.example/feed.xml'
    const entry = (title: string, summary: string) => `<?xml version="1.0"?>
      <feed xmlns="http://www.w3.org/2005/Atom">
        <title>Atom Letters</title>
        <entry>
          <id>tag:atom.example,2026:one</id>
          <title>${title}</title>
          <published>2026-08-08T06:00:00Z</published>
          <summary>${summary}</summary>
        </entry>
      </feed>`
    service.upstream.stub(atomUrl, {
      headers: { 'content-type': 'application/atom+xml' },
      body: entry('first title', 'first summary'),
    })
    const user = await claimedDevice(service)
    expect((await user.post('/api/subscriptions', { url: atomUrl })).status).toBe(201)
    await service.wakeScheduler()

    service.clock.advance(60 * 60 * 1_000)
    service.upstream.stub(atomUrl, {
      headers: { 'content-type': 'application/atom+xml' },
      body: entry('corrected title', 'corrected summary'),
    })
    expect((await user.post('/api/feeds/1/refresh')).status).toBe(200)

    const digest = await (await user.get('/api/digest')).json()
    expect(digest.groups[0].items).toHaveLength(1)
    expect(digest.groups[0].items[0]).toMatchObject({
      title: 'corrected title',
      summary: 'corrected summary',
      firstSeenAt: '2026-08-08T09:00:00.000Z',
    })
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
    await service.wakeScheduler()

    const digest = await (await user.get('/api/digest')).json()
    expect(
      digest.groups[0].items.map((item: { feedTitle: string; title: string }) => [item.feedTitle, item.title]).sort(),
    ).toEqual([
      ['First Wire', 'Syndicated everywhere'],
      ['Second Wire', 'Syndicated everywhere'],
    ])
  })

  it('accepts RDF-shaped RSS 1.0 Feeds', async () => {
    const service = await startTestService()
    const rssUrl = 'https://rdf.example/feed'
    service.upstream.stub(rssUrl, {
      headers: { 'content-type': 'application/rss+xml' },
      body: `<?xml version="1.0"?>
        <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"
                 xmlns="http://purl.org/rss/1.0/"
                 xmlns:dc="http://purl.org/dc/elements/1.1/">
          <channel rdf:about="${rssUrl}">
            <title>RDF Notes</title>
            <link>https://rdf.example/journal</link>
          </channel>
          <item rdf:about="https://rdf.example/one">
            <title>RDF item</title>
            <link>https://rdf.example/one</link>
            <dc:date>2026-08-08T06:00:00Z</dc:date>
          </item>
        </rdf:RDF>`,
    })
    const user = await claimedDevice(service)

    expect((await user.post('/api/subscriptions', { url: rssUrl })).status).toBe(201)
    await service.wakeScheduler()
    const digest = await (await user.get('/api/digest')).json()
    expect(digest.groups[0].items[0]).toMatchObject({
      title: 'RDF item',
      link: 'https://rdf.example/one',
      publishedAt: '2026-08-08T06:00:00.000Z',
    })

    const feeds = await (await user.get('/api/feeds')).json()
    expect(feeds.subscriptions[0]).toMatchObject({ homePageUrl: 'https://rdf.example/journal' })
  })
})
