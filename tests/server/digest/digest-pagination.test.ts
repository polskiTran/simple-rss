import { describe, expect, it } from 'vitest'
import { digestSchema } from '../../../src/shared/api.js'
import { claimedDevice } from '../../support/device.js'
import { startTestService } from '../../support/service-harness.js'

const FEED_URL = 'https://journal.example/feed'

const item = (guid: string, title: string, pubDate: string) => `
  <item>
    <guid>${guid}</guid>
    <title>${title}</title>
    <link>https://journal.example/${guid}</link>
    <pubDate>${new Date(pubDate).toUTCString()}</pubDate>
  </item>`

const rss = (title: string, ...items: string[]) => `<?xml version="1.0"?>
  <rss version="2.0"><channel><title>${title}</title>${items.join('')}</channel></rss>`

/** Feed Items published one minute apart, so their Digest order is exact. */
const minuteItems = (day: string, prefix: string, count: number) =>
  Array.from({ length: count }, (_, index) =>
    item(`${prefix}-${index}`, `${prefix}-${index}`, `${day}T00:${String(index).padStart(2, '0')}:00.000Z`),
  )

/** Titles `prefix-from` down through `prefix-to`, the newest-first order. */
const titlesDown = (prefix: string, from: number, to: number) =>
  Array.from({ length: from - to + 1 }, (_, index) => `${prefix}-${from - index}`)

const flatTitles = (digest: { groups: readonly { items: readonly { title: string }[] }[] }) =>
  digest.groups.flatMap((group) => group.items.map((entry) => entry.title))

describe('the Digest in pages', () => {
  it('serves fifty items at a time, joined by an opaque cursor, splitting a day where the page ends', async () => {
    const service = await startTestService()
    // 55 items today and 10 yesterday: the first page must end mid-today.
    service.upstream.stub(FEED_URL, {
      headers: { 'content-type': 'application/rss+xml' },
      body: rss('Field Notes', ...minuteItems('2026-08-08', 'today', 55), ...minuteItems('2026-08-07', 'past', 10)),
    })
    const user = await claimedDevice(service)
    expect((await user.post('/api/subscriptions', { url: FEED_URL })).status).toBe(201)
    await service.wakeScheduler()

    const first = digestSchema.parse(await (await user.get('/api/digest')).json())

    expect(flatTitles(first)).toEqual(titlesDown('today', 54, 5))
    expect(first.groups.map(({ date }) => date)).toEqual(['2026-08-08'])
    expect(first.nextCursor).toEqual(expect.any(String))

    const rest = digestSchema.parse(
      await (await user.get(`/api/digest?cursor=${encodeURIComponent(first.nextCursor ?? '')}`)).json(),
    )

    // The split day continues under its own date, then yesterday follows.
    expect(rest.groups.map(({ date, label }) => [date, label])).toEqual([
      ['2026-08-08', 'today'],
      ['2026-08-07', 'yesterday'],
    ])
    expect(flatTitles(rest)).toEqual([...titlesDown('today', 4, 0), ...titlesDown('past', 9, 0)])
    expect(rest.nextCursor).toBeNull()
  })

  it('answers a digest that fits one page with no cursor at all', async () => {
    const service = await startTestService()
    service.upstream.stub(FEED_URL, {
      headers: { 'content-type': 'application/rss+xml' },
      body: rss('Field Notes', ...minuteItems('2026-08-08', 'today', 3)),
    })
    const user = await claimedDevice(service)
    expect((await user.post('/api/subscriptions', { url: FEED_URL })).status).toBe(201)
    await service.wakeScheduler()

    const digest = digestSchema.parse(await (await user.get('/api/digest')).json())

    expect(flatTitles(digest)).toHaveLength(3)
    expect(digest.nextCursor).toBeNull()
  })

  it('counts the whole of today in the daily volume even when the page cuts today short', async () => {
    const service = await startTestService()
    service.upstream.stub(FEED_URL, {
      headers: { 'content-type': 'application/rss+xml' },
      body: rss('Field Notes', ...minuteItems('2026-08-08', 'today', 55)),
    })
    const user = await claimedDevice(service)
    expect((await user.post('/api/subscriptions', { url: FEED_URL })).status).toBe(201)
    await service.wakeScheduler()

    const digest = digestSchema.parse(await (await user.get('/api/digest')).json())

    expect(digest.groups[0]?.items).toHaveLength(50)
    expect(digest.today).toEqual({ date: '2026-08-08', volume: 55 })
  })

  it('refuses a cursor it never issued', async () => {
    const service = await startTestService()
    const user = await claimedDevice(service)

    const response = await user.get('/api/digest?cursor=not-a-cursor')

    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ error: { code: 'invalid_cursor' } })
  })

  it('says what follows an item even when the follower is beyond the page boundary', async () => {
    const service = await startTestService()
    service.upstream.stub(FEED_URL, {
      headers: { 'content-type': 'application/rss+xml' },
      body: rss('Field Notes', ...minuteItems('2026-08-08', 'today', 52)),
    })
    const user = await claimedDevice(service)
    expect((await user.post('/api/subscriptions', { url: FEED_URL })).status).toBe(201)
    await service.wakeScheduler()

    const first = digestSchema.parse(await (await user.get('/api/digest')).json())
    const boundary = first.groups[0]?.items.at(-1)
    expect(boundary?.title).toBe('today-2')

    // The Reader's `next in the digest` reaches past the page the item is on.
    const reader = await (await user.get(`/api/items/${boundary?.feedItemId}`)).json()
    expect(reader).toMatchObject({ nextInDigest: { title: 'today-1' } })

    // And the very last item of the whole chronology has nothing after it.
    const rest = digestSchema.parse(
      await (await user.get(`/api/digest?cursor=${encodeURIComponent(first.nextCursor ?? '')}`)).json(),
    )
    const final = rest.groups.at(-1)?.items.at(-1)
    expect(final?.title).toBe('today-0')
    const lastReader = await (await user.get(`/api/items/${final?.feedItemId}`)).json()
    expect(lastReader).toMatchObject({ nextInDigest: null })
  })

  it('continues from a cursor unmoved by items that arrived above it meanwhile', async () => {
    const service = await startTestService()
    service.upstream.stub(FEED_URL, {
      headers: { 'content-type': 'application/rss+xml' },
      body: rss('Field Notes', ...minuteItems('2026-08-08', 'today', 52)),
    })
    const LATER_URL = 'https://letters.example/feed'
    service.upstream.stub(LATER_URL, {
      headers: { 'content-type': 'application/rss+xml' },
      body: rss('Letters', item('fresh', 'A newer letter', '2026-08-08T08:00:00.000Z')),
    })
    const user = await claimedDevice(service)
    expect((await user.post('/api/subscriptions', { url: FEED_URL })).status).toBe(201)
    await service.wakeScheduler()

    const first = digestSchema.parse(await (await user.get('/api/digest')).json())
    expect(flatTitles(first)).toEqual(titlesDown('today', 51, 2))

    // A second Subscription arrives while the User holds the cursor.
    expect((await user.post('/api/subscriptions', { url: LATER_URL })).status).toBe(201)
    await service.wakeScheduler()

    const rest = digestSchema.parse(
      await (await user.get(`/api/digest?cursor=${encodeURIComponent(first.nextCursor ?? '')}`)).json(),
    )

    // Nothing repeats and nothing is skipped: the pages still meet exactly.
    expect(flatTitles(rest)).toEqual(['today-1', 'today-0'])
    expect(rest.nextCursor).toBeNull()

    // The newcomer waits at the top of a fresh first page.
    const fresh = digestSchema.parse(await (await user.get('/api/digest')).json())
    expect(flatTitles(fresh).slice(0, 3)).toEqual(['A newer letter', 'today-51', 'today-50'])
  })
})
