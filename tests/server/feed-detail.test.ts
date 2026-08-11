import { describe, expect, it } from 'vitest'
import { feedDetailSchema } from '../../src/shared/api.js'
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

describe('one opened Feed', () => {
  it('answers with identity, retained Feed Items, cadence observations, schedule, and availability', async () => {
    const service = await startTestService()
    service.upstream.stub(FEED_URL, {
      headers: { 'content-type': 'application/rss+xml' },
      body: rss(
        item('older', 'A June letter', '2026-06-03T12:00:00.000Z'),
        item('last-year', 'A December letter', '2025-12-14T10:00:00.000Z'),
        item('today', 'First light', '2026-08-08T07:15:00.000Z'),
        item('yesterday', 'Evening notes', '2026-08-07T09:31:00.000Z'),
      ),
    })
    const user = await claimedDevice(service)
    expect((await user.post('/api/subscriptions', { url: FEED_URL })).status).toBe(201)
    await service.wakeScheduler()

    const response = await user.get('/api/feeds/1')

    expect(response.status).toBe(200)
    const detail = feedDetailSchema.parse(await response.json())
    expect(detail).toMatchObject({
      feedId: 1,
      title: 'Field Notes',
      domain: 'journal.example',
      availability: { state: 'available', consecutiveFailures: 0 },
      schedule: { pollingIntervalMinutes: 120 },
    })

    // Newest first, each with its installation-timezone day and meta-row date.
    expect(detail.items.map(({ title, date, displayDate }) => [title, date, displayDate])).toEqual([
      ['First light', '2026-08-08', 'today, 07:15'],
      ['Evening notes', '2026-08-07', 'yesterday, 09:31'],
      ['A June letter', '2026-06-03', '3 june'],
      ['A December letter', '2025-12-14', '14 december 2025'],
    ])

    // The grid window: 26 Monday-opened week columns ending today.
    expect(detail.cadence).toHaveLength(181)
    expect(detail.cadence[0]).toEqual({ date: '2026-02-09', count: 0 })
    expect(detail.cadence.at(-1)).toEqual({ date: '2026-08-08', count: 1 })
    expect(detail.cadence.find(({ date }) => date === '2026-06-03')).toEqual({ date: '2026-06-03', count: 1 })
    // Last December sits before the window, so it is retained but not drawn.
    expect(detail.cadence.every(({ count }) => count >= 0)).toBe(true)
    expect(detail.cadence.reduce((sum, { count }) => sum + count, 0)).toBe(3)
  })

  it('is deterministic for a fixed dataset', async () => {
    const service = await startTestService()
    service.upstream.stub(FEED_URL, {
      headers: { 'content-type': 'application/rss+xml' },
      body: rss(item('one', 'First light', '2026-08-08T07:15:00.000Z')),
    })
    const user = await claimedDevice(service)
    expect((await user.post('/api/subscriptions', { url: FEED_URL })).status).toBe(201)
    await service.wakeScheduler()

    const first = await (await user.get('/api/feeds/1')).json()
    const second = await (await user.get('/api/feeds/1')).json()

    expect(second).toEqual(first)
  })

  it('groups cadence days in the installation timezone, not UTC', async () => {
    const service = await startTestService()
    service.upstream.stub(FEED_URL, {
      headers: { 'content-type': 'application/rss+xml' },
      // 20:00 UTC on the 7th is already the morning of the 8th in Auckland.
      body: rss(item('one', 'Crossing midnight', '2026-08-07T20:00:00.000Z')),
    })
    const user = await claimedDevice(service)
    service.settings?.setTimezone('Pacific/Auckland', service.clock.now())
    expect((await user.post('/api/subscriptions', { url: FEED_URL })).status).toBe(201)
    await service.wakeScheduler()

    const detail = feedDetailSchema.parse(await (await user.get('/api/feeds/1')).json())

    expect(detail.items[0]).toMatchObject({ date: '2026-08-08', displayDate: 'today, 08:00' })
    expect(detail.cadence.at(-1)).toEqual({ date: '2026-08-08', count: 1 })
  })

  it('answers not found for a Feed that is not subscribed', async () => {
    const service = await startTestService()
    const user = await claimedDevice(service)

    expect((await user.get('/api/feeds/999')).status).toBe(404)
    expect((await user.get('/api/feeds/1e1')).status).toBe(404)
  })
})
