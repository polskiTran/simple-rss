import { describe, expect, it } from 'vitest'
import { digestSchema, librarySchema } from '../../src/shared/api.js'
import { claimedDevice } from '../support/device.js'
import { startTestService } from '../support/service-harness.js'

const FEED_URL = 'https://journal.example/feed'

const item = (guid: string, title: string, pubDate: string) => `
  <item>
    <guid>${guid}</guid>
    <title>${title}</title>
    <link>https://journal.example/${guid}</link>
    <pubDate>${new Date(pubDate).toUTCString()}</pubDate>
  </item>`

const rss = (...items: string[]) => `<?xml version="1.0"?>
  <rss version="2.0"><channel><title>Field Notes</title>${items.join('')}</channel></rss>`

const minuteItems = (count: number) =>
  Array.from({ length: count }, (_, index) =>
    item(`note-${index}`, `note-${index}`, `2026-08-08T00:${String(index).padStart(2, '0')}:00.000Z`),
  )

describe('the Library in pages', () => {
  it('serves fifty saves at a time on the same cursor the Digest speaks', async () => {
    const service = await startTestService()
    service.upstream.stub(FEED_URL, {
      headers: { 'content-type': 'application/rss+xml' },
      body: rss(...minuteItems(55)),
    })
    const user = await claimedDevice(service)
    expect((await user.post('/api/subscriptions', { url: FEED_URL })).status).toBe(201)
    await service.wakeScheduler()

    const firstPage = digestSchema.parse(await (await user.get('/api/digest')).json())
    const restPage = digestSchema.parse(
      await (await user.get(`/api/digest?cursor=${encodeURIComponent(firstPage.nextCursor ?? '')}`)).json(),
    )
    const allIds = [...firstPage.groups, ...restPage.groups].flatMap((group) =>
      group.items.map((entry) => entry.feedItemId),
    )
    expect(allIds).toHaveLength(55)
    for (const feedItemId of allIds) {
      expect((await user.put(`/api/library/${feedItemId}`)).status).toBe(200)
    }

    const first = librarySchema.parse(await (await user.get('/api/library')).json())

    expect(first.items.map((entry) => entry.title)).toEqual(
      Array.from({ length: 50 }, (_, index) => `note-${54 - index}`),
    )
    expect(first.nextCursor).toEqual(expect.any(String))

    const rest = librarySchema.parse(
      await (await user.get(`/api/library?cursor=${encodeURIComponent(first.nextCursor ?? '')}`)).json(),
    )

    expect(rest.items.map((entry) => entry.title)).toEqual(['note-4', 'note-3', 'note-2', 'note-1', 'note-0'])
    expect(rest.nextCursor).toBeNull()
  })

  it('answers a library that fits one page with no cursor at all', async () => {
    const service = await startTestService()
    service.upstream.stub(FEED_URL, {
      headers: { 'content-type': 'application/rss+xml' },
      body: rss(...minuteItems(2)),
    })
    const user = await claimedDevice(service)
    expect((await user.post('/api/subscriptions', { url: FEED_URL })).status).toBe(201)
    await service.wakeScheduler()
    const digest = digestSchema.parse(await (await user.get('/api/digest')).json())
    const saved = digest.groups[0]?.items[0]
    expect(saved).toBeDefined()
    expect((await user.put(`/api/library/${saved?.feedItemId}`)).status).toBe(200)

    const library = librarySchema.parse(await (await user.get('/api/library')).json())

    expect(library.items).toHaveLength(1)
    expect(library.nextCursor).toBeNull()
  })

  it('refuses a cursor it never issued', async () => {
    const service = await startTestService()
    const user = await claimedDevice(service)

    const response = await user.get('/api/library?cursor=not-a-cursor')

    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ error: { code: 'invalid_cursor' } })
  })
})
