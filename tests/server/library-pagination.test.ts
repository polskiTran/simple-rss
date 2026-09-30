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

/** Subscribes to 55 items and saves them newest item first — against Digest order — `gapMs` apart. */
async function savedNotes(gapMs: number) {
  const service = await startTestService()
  service.upstream.stub(FEED_URL, {
    headers: { 'content-type': 'application/rss+xml' },
    body: rss(...minuteItems(55)),
  })
  const user = await claimedDevice(service)
  expect((await user.post('/api/subscriptions', { url: FEED_URL })).status).toBe(201)
  await service.wakeScheduler()

  const digest = digestSchema.parse(await (await user.get('/api/digest')).json())
  const allIds = digest.groups.flatMap((group) => group.items.map((entry) => entry.feedItemId))
  expect(allIds).toHaveLength(55)
  for (const feedItemId of allIds) {
    expect((await user.put(`/api/library/${feedItemId}`)).status).toBe(200)
    service.clock.advance(gapMs)
  }
  return user
}

/** Every page of the Library in one order, following cursors to the end. */
async function pages(user: Awaited<ReturnType<typeof savedNotes>>, order: 'newest' | 'oldest') {
  const titles: string[][] = []
  let cursor: string | null | undefined
  do {
    const query = new URLSearchParams({ order, ...(cursor ? { cursor } : {}) })
    const page = librarySchema.parse(await (await user.get(`/api/library?${query}`)).json())
    expect(page.total).toBe(55)
    titles.push(page.items.map((entry) => entry.title))
    cursor = page.nextCursor
  } while (cursor)
  return titles
}

const notes = (from: number, to: number) =>
  Array.from({ length: Math.abs(to - from) + 1 }, (_, index) => `note-${from < to ? from + index : from - index}`)

describe('the Library in pages', () => {
  it('serves fifty saves at a time, newest save first unless asked for the oldest', async () => {
    const user = await savedNotes(60_000)

    expect(await pages(user, 'newest')).toEqual([notes(0, 49), notes(50, 54)])
    expect(await pages(user, 'oldest')).toEqual([notes(54, 5), notes(4, 0)])
  })

  it('neither repeats nor drops saves made in the same instant', async () => {
    const user = await savedNotes(0)

    expect((await pages(user, 'newest')).flat().toSorted()).toEqual(notes(0, 54).toSorted())
    expect((await pages(user, 'oldest')).flat().toSorted()).toEqual(notes(0, 54).toSorted())
  })

  it('refuses an order it does not know', async () => {
    const user = await claimedDevice(await startTestService())
    const response = await user.get('/api/library?order=alphabetical')
    expect(response.status).toBe(400)
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
