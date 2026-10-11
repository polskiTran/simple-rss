import { describe, expect, it } from 'vitest'
import { feedItemsSchema } from '../../../src/shared/api.js'
import { claimedDevice } from '../../support/device.js'
import { startTestService } from '../../support/service-harness.js'

const FEED_URL = 'https://journal.example/feed'
const OTHER_FEED_URL = 'https://elsewhere.example/feed'

const item = (guid: string, pubDate: string) => `
  <item>
    <guid>${guid}</guid>
    <title>${guid}</title>
    <link>https://journal.example/${guid}</link>
    <pubDate>${new Date(pubDate).toUTCString()}</pubDate>
  </item>`

const rss = (title: string, items: readonly string[]) => `<?xml version="1.0"?>
  <rss version="2.0"><channel><title>${title}</title>${items.join('')}</channel></rss>`

const minuteItems = (day: string, prefix: string, count: number) =>
  Array.from({ length: count }, (_, index) =>
    item(`${prefix}-${index}`, `${day}T00:${String(index).padStart(2, '0')}:00.000Z`),
  )

async function subscribed(feeds: Readonly<Record<string, readonly string[]>>) {
  const service = await startTestService()
  for (const [url, items] of Object.entries(feeds)) {
    service.upstream.stub(url, { headers: { 'content-type': 'application/rss+xml' }, body: rss(url, items) })
  }
  const user = await claimedDevice(service)
  for (const url of Object.keys(feeds)) {
    expect((await user.post('/api/subscriptions', { url })).status).toBe(201)
  }
  return user
}

/** Each day of a page with how many of its items it carries, newest first. */
const daysOf = ({ items }: { items: readonly { date: string }[] }) =>
  [...Map.groupBy(items, (entry) => entry.date)].map(([date, entries]) => [date, entries.length])

describe("a Feed's items in pages", () => {
  it('serves whole days until fifty items are reached, then goes on from the day it names', async () => {
    const user = await subscribed({
      [FEED_URL]: [
        ...minuteItems('2026-08-08', 'today', 30),
        ...minuteItems('2026-08-07', 'yesterday', 30),
        ...minuteItems('2026-08-06', 'before', 10),
      ],
    })

    const first = feedItemsSchema.parse(await (await user.get('/api/feeds/1/items')).json())

    expect(daysOf(first)).toEqual([
      ['2026-08-08', 30],
      ['2026-08-07', 30],
    ])
    expect(first.nextFrom).toBe('2026-08-06')

    const rest = feedItemsSchema.parse(await (await user.get(`/api/feeds/1/items?from=${first.nextFrom}`)).json())

    expect(daysOf(rest)).toEqual([['2026-08-06', 10]])
    expect(rest.nextFrom).toBeNull()
  })

  it('runs on through a day the cadence grid picked, however far past fifty that is', async () => {
    const user = await subscribed({
      [FEED_URL]: [
        ...minuteItems('2026-08-08', 'today', 50),
        ...minuteItems('2026-08-07', 'yesterday', 50),
        ...minuteItems('2026-08-05', 'earlier', 5),
        ...minuteItems('2026-08-03', 'oldest', 5),
      ],
    })

    const page = feedItemsSchema.parse(
      await (await user.get('/api/feeds/1/items?from=2026-08-07&through=2026-08-05')).json(),
    )

    expect(daysOf(page)).toEqual([
      ['2026-08-07', 50],
      ['2026-08-05', 5],
    ])
    expect(page.nextFrom).toBe('2026-08-03')
  })

  it("counts only this Feed's items toward a page", async () => {
    const user = await subscribed({
      [FEED_URL]: minuteItems('2026-08-07', 'mine', 3),
      [OTHER_FEED_URL]: minuteItems('2026-08-08', 'theirs', 60),
    })

    const page = feedItemsSchema.parse(await (await user.get('/api/feeds/1/items')).json())

    expect(daysOf(page)).toEqual([['2026-08-07', 3]])
    expect(page.nextFrom).toBeNull()
  })

  it('refuses a start that is not a day', async () => {
    const user = await subscribed({ [FEED_URL]: minuteItems('2026-08-08', 'today', 1) })

    expect((await user.get('/api/feeds/1/items?from=yesterday')).status).toBe(400)
    expect((await user.get('/api/feeds/1/items?through=2026-02-30')).status).toBe(400)
  })
})
