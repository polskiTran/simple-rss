import { describe, expect, it, vi } from 'vitest'
import { digestSchema, librarySchema, subscriptionListSchema } from '../../src/shared/api.js'
import { claimedDevice, type Device } from '../support/device.js'
import { startTestService, type TestService } from '../support/service-harness.js'

const START = '2026-08-08T09:00:00.000Z'
const MINUTE_MS = 60_000
const HOUR_MS = 60 * MINUTE_MS
const DAY_MS = 24 * HOUR_MS

const FEED_URL = 'https://journal.example/feed'
const FEED_HEADERS = { 'content-type': 'application/rss+xml; charset=utf-8' }

const item = (guid: string, title: string, pubDate?: string) => `
  <item>
    <guid isPermaLink="false">${guid}</guid>
    <title>${title}</title>
    <link>https://journal.example/${guid}</link>
    ${pubDate ? `<pubDate>${new Date(pubDate).toUTCString()}</pubDate>` : ''}
  </item>`

const rss = (...items: string[]) => `<?xml version="1.0"?>
  <rss version="2.0"><channel><title>Field Notes</title><link>https://journal.example/</link>${items.join('')}</channel></rss>`

const stubFeed = (service: TestService, body: string, url: string = FEED_URL) =>
  service.upstream.stub(url, { headers: FEED_HEADERS, body })

async function subscribed(user: Device, service: TestService, xml: string, url: string = FEED_URL): Promise<void> {
  stubFeed(service, xml, url)
  const response = await user.post('/api/subscriptions', { url })
  expect(response.status).toBe(201)
  await service.wakeScheduler()
}

interface StoredItem {
  readonly title: string
  readonly lastObservedAt: string
}

function storedItems(service: TestService): StoredItem[] {
  return service.database?.$client
    .prepare('SELECT title, last_observed_at AS lastObservedAt FROM feed_items ORDER BY id')
    .all() as StoredItem[]
}

function storedFeedTitles(service: TestService): string[] {
  const rows = service.database?.$client.prepare('SELECT title FROM feeds ORDER BY id').all() as { title: string }[]
  return rows.map((row) => row.title)
}

async function digestTitles(user: Device): Promise<string[]> {
  const digest = digestSchema.parse(await (await user.get('/api/digest')).json())
  return digest.groups.flatMap((group) => group.items.map((entry) => entry.title))
}

async function library(user: Device) {
  return librarySchema.parse(await (await user.get('/api/library')).json())
}

function heldBody(xml: string) {
  const { promise: gate, resolve: release } = Promise.withResolvers<void>()
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      await gate
      controller.enqueue(new TextEncoder().encode(xml))
      controller.close()
    },
  })
  return { body, release }
}

describe('history retention', () => {
  it('refreshes last-observed time for every Feed Item the Feed Window still exposes', async () => {
    const service = await startTestService()
    const user = await claimedDevice(service)
    await subscribed(user, service, rss(item('a', 'Kept'), item('b', 'Dropped')))

    stubFeed(service, rss(item('a', 'Kept')))
    service.clock.advance(3 * HOUR_MS)
    await service.wakeScheduler()

    expect(storedItems(service)).toEqual([
      { title: 'Kept', lastObservedAt: '2026-08-08T12:00:00.000Z' },
      { title: 'Dropped', lastObservedAt: START },
    ])
  })

  it('prunes an unsaved Feed Item 90 days after its last observation, to the minute', async () => {
    const service = await startTestService()
    const user = await claimedDevice(service)
    await subscribed(user, service, rss(item('a', 'Kept'), item('b', 'Dropped')))
    stubFeed(service, rss(item('a', 'Kept')))

    service.clock.advance(90 * DAY_MS - MINUTE_MS)
    await service.wakeScheduler()
    expect(storedItems(service).map((entry) => entry.title)).toEqual(['Kept', 'Dropped'])

    service.clock.advance(MINUTE_MS)
    await service.wakeScheduler()
    expect(storedItems(service).map((entry) => entry.title)).toEqual(['Kept'])

    expect((await user.signIn()).status).toBe(200)
    expect(await digestTitles(user)).toEqual(['Kept'])
  })

  it('retains an item a slow Feed still exposes long after its publication date', async () => {
    const service = await startTestService()
    const user = await claimedDevice(service)
    await subscribed(user, service, rss(item('a', 'Yearly letter', '2026-01-05T08:00:00.000Z')))

    service.clock.advance(89 * DAY_MS)
    await service.wakeScheduler()
    service.clock.advance(2 * DAY_MS)
    await service.wakeScheduler()

    expect(storedItems(service).map((entry) => entry.title)).toEqual(['Yearly letter'])
    expect((await user.signIn()).status).toBe(200)
    expect(await digestTitles(user)).toEqual(['Yearly letter'])
  })

  it('never prunes the Library, however old and whatever happened to the Feed', async () => {
    const service = await startTestService()
    const user = await claimedDevice(service)
    await subscribed(user, service, rss(item('a', 'Saved essay'), item('b', 'Passing note')))
    const saved = await user.put('/api/library/1')
    expect(saved.status).toBe(200)

    stubFeed(service, rss())
    service.clock.advance(91 * DAY_MS)
    await service.wakeScheduler()
    expect(storedItems(service).map((entry) => entry.title)).toEqual(['Saved essay'])

    expect((await user.signIn()).status).toBe(200)
    expect((await user.delete('/api/feeds/1')).status).toBe(204)
    await service.wakeScheduler()
    expect(storedItems(service).map((entry) => entry.title)).toEqual(['Saved essay'])
    expect((await library(user)).items.map((entry) => [entry.title, entry.feedTitle, entry.subscribed])).toEqual([
      ['Saved essay', 'Field Notes', false],
    ])
  })

  it('keeps an aged item that the same wake re-observes — the poll counts before the sweep', async () => {
    const service = await startTestService()
    const user = await claimedDevice(service)
    await subscribed(user, service, rss(item('a', 'Quarterly letter')))

    service.clock.advance(91 * DAY_MS)
    await service.wakeScheduler()

    expect(storedItems(service)).toEqual([
      {
        title: 'Quarterly letter',
        lastObservedAt: new Date(new Date(START).getTime() + 91 * DAY_MS).toISOString(),
      },
    ])
  })

  it('unsubscribing stops polling immediately and clears the Digest of that Feed', async () => {
    const service = await startTestService()
    const user = await claimedDevice(service)
    await subscribed(user, service, rss(item('a', 'First light')))
    expect(await digestTitles(user)).toEqual(['First light'])

    expect((await user.delete('/api/feeds/1')).status).toBe(204)

    expect(await digestTitles(user)).toEqual([])
    const list = subscriptionListSchema.parse(await (await user.get('/api/feeds')).json())
    expect(list.subscriptions).toEqual([])
    expect((await user.get('/api/feeds/1')).status).toBe(404)

    service.clock.advance(24 * HOUR_MS)
    await service.wakeScheduler()
    expect(service.upstream.requestsTo(FEED_URL)).toHaveLength(1)

    expect((await user.delete('/api/feeds/1')).status).toBe(404)
    expect((await user.delete('/api/feeds/abc')).status).toBe(404)
  })

  it('cleanup clears an unsubscribed Feed but keeps saves and their attribution', async () => {
    const service = await startTestService()
    const user = await claimedDevice(service)
    await subscribed(user, service, rss(item('a', 'Saved essay'), item('b', 'Passing note')))
    expect((await user.put('/api/library/1')).status).toBe(200)

    expect((await user.delete('/api/feeds/1')).status).toBe(204)
    await service.wakeScheduler()

    expect(storedItems(service).map((entry) => entry.title)).toEqual(['Saved essay'])
    expect(storedFeedTitles(service)).toEqual(['Field Notes'])
    expect((await library(user)).items.map((entry) => [entry.title, entry.feedTitle, entry.subscribed])).toEqual([
      ['Saved essay', 'Field Notes', false],
    ])

    expect((await user.delete('/api/library/1')).status).toBe(200)
    await service.wakeScheduler()
    expect(storedItems(service)).toEqual([])
    expect(storedFeedTitles(service)).toEqual([])
  })

  it('sweeps a bounded batch per wake and converges over the following wakes', async () => {
    const service = await startTestService({ retention: { batchLimit: 2 } })
    const user = await claimedDevice(service)
    await subscribed(user, service, rss(item('a', 'One'), item('b', 'Two'), item('c', 'Three')))

    expect((await user.delete('/api/feeds/1')).status).toBe(204)
    await service.wakeScheduler()
    expect(storedItems(service)).toHaveLength(1)

    await service.wakeScheduler()
    expect(storedItems(service)).toEqual([])
    expect(storedFeedTitles(service)).toEqual([])
  })

  it('resumes cleanup after a container replacement, from persisted observations alone', async () => {
    const service = await startTestService()
    const user = await claimedDevice(service)
    await subscribed(user, service, rss(item('a', 'Kept'), item('b', 'Dropped')))
    stubFeed(service, rss(item('a', 'Kept')))

    service.clock.advance(91 * DAY_MS)
    await service.restart()
    await service.wakeScheduler()

    expect(storedItems(service).map((entry) => entry.title)).toEqual(['Kept'])
  })

  it('cannot be raced by an in-flight poll into resurrecting an unsubscribed Feed', async () => {
    const service = await startTestService()
    const user = await claimedDevice(service)
    await subscribed(user, service, rss(item('a', 'First light')))
    await service.wakeScheduler()
    service.clock.advance(60_000)

    const { body, release } = heldBody(rss(item('a', 'First light'), item('b', 'Late arrival')))
    service.upstream.stub(FEED_URL, { headers: FEED_HEADERS, body })
    const refreshing = user.post('/api/feeds/1/refresh')
    await vi.waitFor(() => expect(service.upstream.requestsTo(FEED_URL)).toHaveLength(2))

    expect((await user.delete('/api/feeds/1')).status).toBe(204)
    release()

    expect((await refreshing).status).toBe(404)
    expect(storedItems(service).map((entry) => entry.title)).toEqual(['First light'])

    await service.wakeScheduler()
    expect(storedItems(service)).toEqual([])
    expect(storedFeedTitles(service)).toEqual([])
  })

  it('revives a Feed retained for the Library when the User resubscribes', async () => {
    const service = await startTestService()
    const user = await claimedDevice(service)
    await subscribed(user, service, rss(item('a', 'Saved essay'), item('b', 'Passing note')))
    expect((await user.put('/api/library/1')).status).toBe(200)

    expect((await user.delete('/api/feeds/1')).status).toBe(204)
    await service.wakeScheduler()
    expect(storedItems(service).map((entry) => entry.title)).toEqual(['Saved essay'])

    const revived = await user.post('/api/subscriptions', { url: FEED_URL })
    expect(revived.status).toBe(201)
    const body = (await revived.json()) as { subscription: { feedId: number } }
    expect(body.subscription.feedId).toBe(1)
    service.clock.advance(60_000)
    await service.wakeScheduler()

    expect((await digestTitles(user)).sort()).toEqual(['Passing note', 'Saved essay'])
    expect((await library(user)).items.map((entry) => [entry.feedItemId, entry.title])).toEqual([[1, 'Saved essay']])

    service.clock.advance(3 * HOUR_MS)
    await service.wakeScheduler()
    expect(service.upstream.requestsTo(FEED_URL).length).toBeGreaterThanOrEqual(3)
  })
})
