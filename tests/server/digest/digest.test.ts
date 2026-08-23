import { describe, expect, it } from 'vitest'
import { digestSchema } from '../../../src/shared/api.js'
import { claimedDevice } from '../../support/device.js'
import { startTestService } from '../../support/service-harness.js'

const FEED_URL = 'https://journal.example/feed'

const item = (guid: string, title: string, pubDate?: string) => `
  <item>
    <guid>${guid}</guid>
    <title>${title}</title>
    <link>https://journal.example/${guid}</link>
    ${pubDate ? `<pubDate>${new Date(pubDate).toUTCString()}</pubDate>` : ''}
  </item>`

const rss = (...items: string[]) => `<?xml version="1.0"?>
  <rss version="2.0"><channel><title>Field Notes</title>${items.join('')}</channel></rss>`

const stubFeed = (service: Awaited<ReturnType<typeof startTestService>>, body: string) =>
  service.upstream.stub(FEED_URL, { headers: { 'content-type': 'application/rss+xml' }, body })

describe('the chronological Digest', () => {
  it('groups items under today, yesterday, and then calendar dates, newest first', async () => {
    const service = await startTestService()
    stubFeed(
      service,
      rss(
        item('june', 'A June letter', '2026-06-03T12:00:00.000Z'),
        item('today', 'First light', '2026-08-08T07:15:00.000Z'),
        item('yesterday', 'Evening notes', '2026-08-07T09:31:00.000Z'),
      ),
    )
    const user = await claimedDevice(service)
    expect((await user.post('/api/subscriptions', { url: FEED_URL })).status).toBe(201)
    await service.wakeScheduler()

    const digest = digestSchema.parse(await (await user.get('/api/digest')).json())

    expect(digest.today).toEqual({ date: '2026-08-08', volume: 1 })
    expect(digest.groups.map(({ date, label }) => [date, label])).toEqual([
      ['2026-08-08', 'today'],
      ['2026-08-07', 'yesterday'],
      ['2026-06-03', 'june 3, 2026'],
    ])
    expect(digest.groups.map((group) => group.items.map((entry) => entry.title))).toEqual([
      ['First light'],
      ['Evening notes'],
      ['A June letter'],
    ])
  })

  it('keeps stored timestamps UTC while grouping in the installation timezone', async () => {
    const service = await startTestService()
    stubFeed(service, rss(item('one', 'Crossing midnight', '2026-08-07T20:00:00.000Z')))
    const user = await claimedDevice(service)
    service.settings?.setTimezone('Pacific/Auckland', service.clock.now())
    expect((await user.post('/api/subscriptions', { url: FEED_URL })).status).toBe(201)
    await service.wakeScheduler()

    const digest = digestSchema.parse(await (await user.get('/api/digest')).json())

    expect(digest.groups.map(({ date, label }) => [date, label])).toEqual([['2026-08-08', 'today']])
    expect(digest.groups[0]?.items[0]).toMatchObject({
      publishedAt: '2026-08-07T20:00:00.000Z',
      displayTime: '08:00',
    })

    const stored = service.database?.$client
      .prepare('select published_at as publishedAt, first_seen_at as firstSeenAt from feed_items')
      .get() as { publishedAt: string; firstSeenAt: string }
    expect(stored.publishedAt).toBe('2026-08-07T20:00:00.000Z')
    expect(stored.firstSeenAt).toBe('2026-08-08T09:00:00.000Z')
  })

  it('orders a missing or implausibly future publication by first-seen time', async () => {
    const service = await startTestService()
    stubFeed(
      service,
      rss(
        item('ahead', 'From a broken clock', '2026-08-19T09:00:00.000Z'),
        item('undated', 'An undated letter'),
        item('dated', 'First light', '2026-08-08T07:15:00.000Z'),
      ),
    )
    const user = await claimedDevice(service)
    expect((await user.post('/api/subscriptions', { url: FEED_URL })).status).toBe(201)
    await service.wakeScheduler()

    const digest = digestSchema.parse(await (await user.get('/api/digest')).json())

    expect(digest.groups.map(({ label }) => label)).toEqual(['today'])
    expect(digest.groups[0]?.items.map((entry) => entry.title)).toEqual([
      'An undated letter',
      'From a broken clock',
      'First light',
    ])
    expect(digest.groups[0]?.items[1]?.publishedAt).toBe('2026-08-19T09:00:00.000Z')
  })

  it('breaks publication-time ties stably, and identically across reads', async () => {
    const service = await startTestService()
    stubFeed(
      service,
      rss(
        item('first', 'Posted together, listed second', '2026-08-08T07:15:00.000Z'),
        item('second', 'Posted together, listed first', '2026-08-08T07:15:00.000Z'),
      ),
    )
    const user = await claimedDevice(service)
    expect((await user.post('/api/subscriptions', { url: FEED_URL })).status).toBe(201)
    await service.wakeScheduler()

    const first = await (await user.get('/api/digest')).json()
    const second = await (await user.get('/api/digest')).json()

    expect(first.groups[0].items.map((entry: { title: string }) => entry.title)).toEqual([
      'Posted together, listed first',
      'Posted together, listed second',
    ])
    expect(second).toEqual(first)
  })

  it('carries no read state, ranking, or unread count anywhere in its shape', async () => {
    const service = await startTestService()
    stubFeed(service, rss(item('one', 'First light', '2026-08-08T07:15:00.000Z')))
    const user = await claimedDevice(service)
    expect((await user.post('/api/subscriptions', { url: FEED_URL })).status).toBe(201)
    await service.wakeScheduler()

    const body = await (await user.get('/api/digest')).text()

    expect(body).not.toMatch(/read|rank|score|badge/i)
  })
})
