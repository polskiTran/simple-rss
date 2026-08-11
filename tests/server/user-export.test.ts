import { describe, expect, it } from 'vitest'
import { USER_EXPORT_FORMAT, USER_EXPORT_VERSION } from '../../src/server/export/user-export.js'
import { migrations } from '../../src/server/persistence/migrations.js'
import { VERSION } from '../../src/shared/version.js'
import { Device, claimedDevice } from '../support/device.js'
import { startTestService, type TestService } from '../support/service-harness.js'

const RSS_URL = 'https://journal.example/feed'
const ATOM_URL = 'https://atom.example/feed.xml'

/** A validator value that must never leave the installation in an export. */
const RSS_ETAG = '"etag-value-that-stays-home"'

const RSS = `<?xml version="1.0"?>
  <rss version="2.0"><channel><title>Field Notes</title>
    <item>
      <guid>entry-1</guid><title>First light</title><link>https://journal.example/one</link>
      <description>A morning note</description><pubDate>Fri, 08 Aug 2026 07:15:00 GMT</pubDate>
    </item>
  </channel></rss>`

const ATOM = `<?xml version="1.0"?>
  <feed xmlns="http://www.w3.org/2005/Atom">
    <title>Atom Letters</title>
    <entry><id>tag:atom.example,2026:one</id><title>One letter</title><published>2026-08-08T06:00:00Z</published></entry>
  </feed>`

function stubFeeds(service: TestService): void {
  service.upstream
    .stub(RSS_URL, { headers: { 'content-type': 'application/rss+xml', etag: RSS_ETAG }, body: RSS })
    .stub(ATOM_URL, { headers: { 'content-type': 'application/atom+xml' }, body: ATOM })
}

describe('the JSON export', () => {
  it('is closed to anyone but the User', async () => {
    const service = await startTestService()
    await claimedDevice(service)

    expect((await new Device(service).get('/api/export')).status).toBe(401)
  })

  it('downloads as a versioned attachment that is never cached', async () => {
    const service = await startTestService()
    const user = await claimedDevice(service)

    const exported = await user.get('/api/export')

    expect(exported.status).toBe(200)
    expect(exported.headers.get('content-type')).toContain('application/json')
    expect(exported.headers.get('content-disposition')).toBe('attachment; filename="simple-rss-export.json"')
    expect(exported.headers.get('cache-control')).toBe('no-store')

    const document = await exported.json()
    expect(document.format).toBe(USER_EXPORT_FORMAT)
    expect(document.exportVersion).toBe(USER_EXPORT_VERSION)
    expect(document.schemaVersion).toBe(migrations[migrations.length - 1]!.version)
    expect(document.applicationVersion).toBe(VERSION)
  })

  it('carries Subscriptions, Polling Intervals, Feed metadata, retained Feed Items, Library membership, and preferences', async () => {
    const service = await startTestService()
    stubFeeds(service)
    const user = await claimedDevice(service)
    await user.put('/api/settings/timezone', { timezone: 'Europe/Berlin' })
    expect((await user.post('/api/subscriptions', { url: RSS_URL })).status).toBe(201)
    await service.wakeScheduler()
    expect((await user.post('/api/subscriptions', { url: ATOM_URL })).status).toBe(201)
    await service.wakeScheduler()

    const feeds = await (await user.get('/api/feeds')).json()
    const fieldNotes = feeds.subscriptions.find((entry: { title: string }) => entry.title === 'Field Notes')
    await user.put(`/api/feeds/${fieldNotes.feedId}/interval`, { pollingIntervalMinutes: 360 })
    const detail = await (await user.get(`/api/feeds/${fieldNotes.feedId}`)).json()
    expect((await user.put(`/api/library/${detail.items[0].feedItemId}`)).status).toBe(200)

    const document = await (await user.get('/api/export')).json()

    expect(document.installation).toEqual({ timezone: 'Europe/Berlin' })
    expect(document.exportedAt).toBe(service.clock.now().toISOString())

    expect(document.feeds).toHaveLength(2)
    const exportedRss = document.feeds.find((feed: { title: string }) => feed.title === 'Field Notes')
    expect(exportedRss).toMatchObject({
      enteredUrl: RSS_URL,
      resolvedUrl: RSS_URL,
      domain: 'journal.example',
      subscription: { pollingIntervalMinutes: 360 },
    })
    expect(exportedRss.items).toEqual([
      {
        title: 'First light',
        link: 'https://journal.example/one',
        summary: 'A morning note',
        publishedAt: '2026-08-08T07:15:00.000Z',
        imageUrl: null,
        identityKind: 'guid',
        dedupeKey: expect.any(String),
        firstSeenAt: expect.any(String),
        lastObservedAt: expect.any(String),
        savedAt: service.clock.now().toISOString(),
      },
    ])

    const exportedAtom = document.feeds.find((feed: { title: string }) => feed.title === 'Atom Letters')
    expect(exportedAtom.subscription).toEqual({ pollingIntervalMinutes: 120, createdAt: expect.any(String) })
    expect(exportedAtom.items[0].savedAt).toBeNull()
  })

  it('keeps an unsubscribed Feed that Library saves still attribute', async () => {
    const service = await startTestService()
    stubFeeds(service)
    const user = await claimedDevice(service)
    expect((await user.post('/api/subscriptions', { url: RSS_URL })).status).toBe(201)
    await service.wakeScheduler()

    const feeds = await (await user.get('/api/feeds')).json()
    const feedId = feeds.subscriptions[0].feedId
    const detail = await (await user.get(`/api/feeds/${feedId}`)).json()
    await user.put(`/api/library/${detail.items[0].feedItemId}`)
    expect((await user.delete(`/api/feeds/${feedId}`)).status).toBe(204)

    const document = await (await user.get('/api/export')).json()

    expect(document.feeds).toHaveLength(1)
    expect(document.feeds[0]).toMatchObject({ title: 'Field Notes', subscription: null })
    expect(document.feeds[0].items.some((item: { savedAt: string | null }) => item.savedAt !== null)).toBe(true)
  })

  it('excludes verifiers, sessions, retrieval caches, schedules, and migration internals', async () => {
    const service = await startTestService()
    stubFeeds(service)
    const user = await claimedDevice(service)
    expect((await user.post('/api/subscriptions', { url: RSS_URL })).status).toBe(201)
    await service.wakeScheduler()

    const exported = await user.get('/api/export')
    const text = await exported.text()
    const document = JSON.parse(text)

    // The whole document is these keys and nothing else, so nothing sensitive
    // can ride along unnoticed.
    expect(Object.keys(document).sort()).toEqual([
      'applicationVersion',
      'exportVersion',
      'exportedAt',
      'feeds',
      'format',
      'installation',
      'schemaVersion',
    ])
    expect(Object.keys(document.feeds[0]).sort()).toEqual([
      'createdAt',
      'domain',
      'enteredUrl',
      'items',
      'resolvedUrl',
      'subscription',
      'title',
    ])

    // The verifier, the session hash, and the conditional-request validator
    // all exist in the database this export was drawn from.
    const storedHash = service.database?.prepare('SELECT password_hash FROM user_auth').get() as {
      password_hash: string
    }
    const storedSession = service.database?.prepare('SELECT token_hash FROM sessions').get() as {
      token_hash: string
    }
    expect(text).not.toContain(storedHash.password_hash)
    expect(text).not.toContain(storedSession.token_hash)
    expect(text).not.toContain(RSS_ETAG.replaceAll('"', ''))
    expect(text).not.toMatch(/passwordHash|tokenHash|etag|lastModified|nextPollAt|appliedAt/)
  })
})
