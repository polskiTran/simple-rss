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

const minuteItems = (day: string, prefix: string, count: number) =>
  Array.from({ length: count }, (_, index) =>
    item(`${prefix}-${index}`, `${prefix}-${index}`, `${day}T00:${String(index).padStart(2, '0')}:00.000Z`),
  )

const titlesDown = (prefix: string, from: number, to: number) =>
  Array.from({ length: from - to + 1 }, (_, index) => `${prefix}-${from - index}`)

const flatTitles = (digest: { groups: readonly { items: readonly { title: string }[] }[] }) =>
  digest.groups.flatMap((group) => group.items.map((entry) => entry.title))

async function subscribed(...items: string[]) {
  const service = await startTestService()
  service.upstream.stub(FEED_URL, {
    headers: { 'content-type': 'application/rss+xml' },
    body: rss('Field Notes', ...items),
  })
  const user = await claimedDevice(service)
  expect((await user.post('/api/subscriptions', { url: FEED_URL })).status).toBe(201)
  return { service, user }
}

describe('the Digest in pages', () => {
  it('serves whole days until fifty items are reached, then names the day the next page starts from', async () => {
    const { user } = await subscribed(
      ...minuteItems('2026-08-08', 'today', 30),
      ...minuteItems('2026-08-07', 'yesterday', 30),
      ...minuteItems('2026-08-06', 'before', 10),
    )

    const first = digestSchema.parse(await (await user.get('/api/digest')).json())

    expect(first.groups.map(({ date, items }) => [date, items.length])).toEqual([
      ['2026-08-08', 30],
      ['2026-08-07', 30],
    ])
    expect(first.nextFrom).toBe('2026-08-06')

    const rest = digestSchema.parse(await (await user.get(`/api/digest?from=${first.nextFrom}`)).json())

    expect(flatTitles(rest)).toEqual(titlesDown('before', 9, 0))
    expect(rest.nextFrom).toBeNull()
  })

  it('serves a busy day whole, however far past fifty it runs', async () => {
    const { user } = await subscribed(
      ...minuteItems('2026-08-08', 'today', 55),
      ...minuteItems('2026-08-07', 'yesterday', 3),
    )

    const digest = digestSchema.parse(await (await user.get('/api/digest')).json())

    expect(flatTitles(digest)).toEqual(titlesDown('today', 54, 0))
    expect(digest.nextFrom).toBe('2026-08-07')
  })

  it('answers a digest that fits one page with no next day at all', async () => {
    const { user } = await subscribed(...minuteItems('2026-08-08', 'today', 3))

    const digest = digestSchema.parse(await (await user.get('/api/digest')).json())

    expect(flatTitles(digest)).toHaveLength(3)
    expect(digest.nextFrom).toBeNull()
  })

  it('says what follows an item even when the follower is on the next page', async () => {
    const { user } = await subscribed(
      ...minuteItems('2026-08-08', 'today', 50),
      ...minuteItems('2026-08-07', 'yesterday', 2),
    )

    const first = digestSchema.parse(await (await user.get('/api/digest')).json())
    const boundary = first.groups.at(-1)?.items.at(-1)
    expect(boundary?.title).toBe('today-0')

    const reader = await (await user.get(`/api/items/${boundary?.feedItemId}`)).json()
    expect(reader).toMatchObject({ nextInDigest: { title: 'yesterday-1' } })
  })

  it('continues from its day unmoved by items that arrived above it meanwhile', async () => {
    const { service, user } = await subscribed(
      ...minuteItems('2026-08-08', 'today', 50),
      ...minuteItems('2026-08-07', 'yesterday', 2),
    )
    const first = digestSchema.parse(await (await user.get('/api/digest')).json())

    const LATER_URL = 'https://letters.example/feed'
    service.upstream.stub(LATER_URL, {
      headers: { 'content-type': 'application/rss+xml' },
      body: rss('Letters', item('fresh', 'A newer letter', '2026-08-08T08:00:00.000Z')),
    })
    expect((await user.post('/api/subscriptions', { url: LATER_URL })).status).toBe(201)

    const rest = digestSchema.parse(await (await user.get(`/api/digest?from=${first.nextFrom}`)).json())
    expect(flatTitles(rest)).toEqual(['yesterday-1', 'yesterday-0'])

    const fresh = digestSchema.parse(await (await user.get('/api/digest')).json())
    expect(flatTitles(fresh).slice(0, 2)).toEqual(['A newer letter', 'today-49'])
  })
})
