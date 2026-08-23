import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_POLLING_INTERVAL_MINUTES, MAX_FEED_SIZE_MIB } from '../../src/shared/api.js'
import { nextPollTime } from '../../src/server/subscriptions/polling-schedule.js'
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
  it('proves the Feed inside the request: the row arrives available, its items already in the Digest', async () => {
    const service = await startTestService({ scheduling: { nudges: true } })
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
      observedItems: 1,
    })
    expect(service.logs).toContainEqual(
      expect.objectContaining({
        message: 'subscriptions.subscription_created',
        enteredUrl: ENTERED_URL,
      }),
    )

    const aliases = service.database?.prepare('SELECT url, feed_id AS feedId FROM feed_url_aliases ORDER BY url').all()
    expect(aliases).toEqual([
      { url: RESOLVED_URL, feedId: 1 },
      { url: ENTERED_URL, feedId: 1 },
    ])
    const schedule = await (await user.get('/api/feeds/1')).json()
    expect(schedule.schedule.nextPollAt).toBe(nextPollTime(1, DEFAULT_POLLING_INTERVAL_MINUTES, service.clock.now()))

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

    // Nothing is due: the request was the first retrieval, so a wake — nudged or not — retrieves nothing.
    await service.wakeScheduler()
    expect(service.upstream.requests.map((request) => request.url)).toEqual([ENTERED_URL, RESOLVED_URL])
    expect(service.logs).not.toContainEqual(expect.objectContaining({ message: 'scheduler.feed_polled' }))
  })

  it('does not nudge the scheduler: a Feed due meanwhile waits for the wake', async () => {
    const service = await startTestService({ scheduling: { nudges: true } })
    const importedUrl = 'https://atom.example/feed.xml'
    service.upstream
      .stub(ENTERED_URL, { headers: { 'content-type': 'application/rss+xml' }, body: RSS })
      .stub(importedUrl, {
        headers: { 'content-type': 'application/atom+xml' },
        body: '<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><title>Atom Letters</title></feed>',
      })
    const user = await claimedDevice(service)
    const opml = `<?xml version="1.0"?><opml version="2.0"><body><outline type="rss" xmlUrl="${importedUrl}"/></body></opml>`
    expect((await user.post('/api/subscriptions/import', { opml })).status).toBe(200)
    await vi.waitFor(() => expect(service.upstream.requestsTo(importedUrl)).toHaveLength(1))
    service.clock.advance(3 * 60 * 60_000)

    expect((await user.post('/api/subscriptions', { url: ENTERED_URL })).status).toBe(201)

    expect(service.upstream.requestsTo(importedUrl)).toHaveLength(1)
    await service.wakeScheduler()
    expect(service.upstream.requestsTo(importedUrl)).toHaveLength(2)
  })

  it('asks unconditionally: the proof carries no validators', async () => {
    const service = await startTestService()
    service.upstream.stub(ENTERED_URL, {
      headers: {
        'content-type': 'application/rss+xml',
        etag: '"v1"',
        'last-modified': 'Fri, 08 Aug 2026 07:00:00 GMT',
      },
      body: RSS,
    })
    const user = await claimedDevice(service)

    expect((await user.post('/api/subscriptions', { url: ENTERED_URL })).status).toBe(201)

    const [request] = service.upstream.requestsTo(ENTERED_URL)
    expect(request?.headers).not.toHaveProperty('if-none-match')
    expect(request?.headers).not.toHaveProperty('if-modified-since')
  })

  it.each([
    ['http_error', 502, { status: 500, headers: { 'content-type': 'text/plain' }, body: 'gone' }],
    ['unreachable', 502, undefined],
    ['timeout', 504, { headers: { 'content-type': 'application/rss+xml' }, body: RSS, delayMs: 200 }],
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
    ['invalid_feed', 422, { headers: { 'content-type': 'application/rss+xml' }, body: 'not a feed at all' }],
    [
      'no_feed_found',
      422,
      { headers: { 'content-type': 'text/html; charset=utf-8' }, body: '<html><body>a page</body></html>' },
    ],
  ] as const)('answers %s as %i and leaves no row', async (code, status, response) => {
    // The preview deadline is tightened so the slow publisher times out in test time.
    const service = await startTestService({
      retrieval: (boundary) => ({
        retrieve: (request) => boundary.retrieve(request),
        retrieveBytes: (request) => boundary.retrieveBytes({ ...request, limits: { timeoutMs: 20 } }),
      }),
    })
    if (response) service.upstream.stub(ENTERED_URL, response)
    const user = await claimedDevice(service)

    const refused = await user.post('/api/subscriptions', { url: ENTERED_URL })

    expect(refused.status).toBe(status)
    expect(await refused.json()).toMatchObject({ error: { code } })
    expect(service.database?.prepare('SELECT count(*) AS count FROM feeds').get()).toEqual({ count: 0 })
    expect(await (await user.get('/api/feeds')).json()).toEqual({ subscriptions: [] })
  })

  it('answers an address that is not a public web address with 400 and never asks anyone', async () => {
    const service = await startTestService()
    const user = await claimedDevice(service)

    for (const url of ['not a URL', 'ftp://journal.example/feed', 'https://user:secret@journal.example/feed']) {
      const refused = await user.post('/api/subscriptions', { url })
      expect(refused.status, url).toBe(400)
      expect(await refused.json()).toMatchObject({ error: { code: 'invalid_feed_url' } })
    }
    expect(service.upstream.requests).toHaveLength(0)
    expect(await (await user.get('/api/feeds')).json()).toEqual({ subscriptions: [] })
  })

  it('answers 409 when the URL redirects onto a Feed already subscribed', async () => {
    const service = await startTestService()
    service.upstream.stub(ENTERED_URL, { headers: { 'content-type': 'application/rss+xml' }, body: RSS })
    const user = await claimedDevice(service)
    expect((await user.post('/api/subscriptions', { url: ENTERED_URL })).status).toBe(201)

    const alias = 'https://alias.example/feed'
    service.upstream.stub(alias, { status: 301, headers: { location: ENTERED_URL, 'content-type': 'text/plain' } })
    const duplicate = await user.post('/api/subscriptions', { url: alias })

    expect(duplicate.status).toBe(409)
    expect(await duplicate.json()).toMatchObject({
      error: { code: 'duplicate_subscription' },
      subscription: { feedId: 1, title: 'Field Notes' },
    })
    expect(service.database?.prepare('SELECT count(*) AS count FROM feeds').get()).toEqual({ count: 1 })
    expect(service.database?.prepare('SELECT count(*) AS count FROM feed_url_aliases').get()).toEqual({ count: 1 })
  })

  it('revives a dormant Feed under its own row, so Library attribution survives resubscribing', async () => {
    const service = await startTestService()
    service.upstream
      .stub(ENTERED_URL, { status: 301, headers: { location: RESOLVED_URL, 'content-type': 'text/plain' } })
      .stub(RESOLVED_URL, { headers: { 'content-type': 'application/rss+xml' }, body: RSS })
    const user = await claimedDevice(service)
    expect((await user.post('/api/subscriptions', { url: ENTERED_URL })).status).toBe(201)
    expect((await user.put('/api/library/1')).status).toBe(200)
    expect((await user.delete('/api/feeds/1')).status).toBe(204)

    service.clock.advance(60 * 60_000)
    const mirrorUrl = 'https://mirror.example/feed'
    service.upstream
      .stub(mirrorUrl, { status: 301, headers: { location: RESOLVED_URL, 'content-type': 'text/plain' } })
      .stub(RESOLVED_URL, {
        headers: { 'content-type': 'application/rss+xml' },
        body: RSS.replace(
          '</item>',
          '</item><item><guid>entry-2</guid><title>Second light</title><pubDate>Fri, 08 Aug 2026 09:30:00 GMT</pubDate></item>',
        ),
      })
    const revived = await user.post('/api/subscriptions', { url: mirrorUrl })

    expect(revived.status).toBe(201)
    expect(await revived.json()).toMatchObject({
      subscription: {
        feedId: 1,
        enteredUrl: ENTERED_URL,
        resolvedUrl: RESOLVED_URL,
        availability: { state: 'available', lastSuccessAt: '2026-08-08T10:00:00.000Z' },
      },
      observedItems: 2,
    })
    expect(service.database?.prepare('SELECT count(*) AS count FROM feeds').get()).toEqual({ count: 1 })
    expect(service.database?.prepare('SELECT url FROM feed_url_aliases WHERE feed_id = 1 ORDER BY url').all()).toEqual([
      { url: RESOLVED_URL },
      { url: ENTERED_URL },
      { url: mirrorUrl },
    ])
    const library = await (await user.get('/api/library')).json()
    expect(library.items).toMatchObject([{ title: 'First light', feedTitle: 'Field Notes', subscribed: true }])
    const digest = await (await user.get('/api/digest')).json()
    expect(digest.groups[0].items.map((item: { title: string }) => item.title)).toEqual(['Second light', 'First light'])
  })

  it('answers the second of two concurrent subscribes to one Feed with 409', async () => {
    const service = await startTestService()
    service.upstream.stub(ENTERED_URL, { headers: { 'content-type': 'application/rss+xml' }, body: RSS })
    const user = await claimedDevice(service)

    const answers = await Promise.all([
      user.post('/api/subscriptions', { url: ENTERED_URL }),
      user.post('/api/subscriptions', { url: ENTERED_URL }),
    ])

    expect(answers.map((answer) => answer.status).sort()).toEqual([201, 409])
    expect((await (await user.get('/api/feeds')).json()).subscriptions).toHaveLength(1)
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
    service.upstream.stub(ENTERED_URL, { headers: { 'content-type': 'application/rss+xml' }, body: RSS })
    const exact = 'https://journal.example:443/feed#user-fragment'
    const user = await claimedDevice(service)

    const added = await user.post('/api/subscriptions', { url: exact })
    expect(await added.json()).toMatchObject({
      subscription: { enteredUrl: exact, resolvedUrl: ENTERED_URL },
    })

    expect((await user.post('/api/subscriptions', { url: ENTERED_URL })).status).toBe(409)
    expect((await (await user.get('/api/feeds')).json()).subscriptions).toHaveLength(1)
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
