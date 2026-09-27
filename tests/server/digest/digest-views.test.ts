import { describe, expect, it } from 'vitest'
import {
  CADENCE_GRID_WEEKS,
  digestCalendarSchema,
  digestDaySchema,
  digestFeedsSchema,
  digestSchema,
} from '../../../src/shared/api.js'
import { claimedDevice, type Device } from '../../support/device.js'
import { startTestService, type TestService } from '../../support/service-harness.js'

// The harness clock reads 2026-08-08T09:00Z.

const item = (guid: string, pubDate: string) => `
  <item>
    <guid>${guid}</guid>
    <title>${guid}</title>
    <link>https://journal.example/${guid}</link>
    <pubDate>${new Date(pubDate).toUTCString()}</pubDate>
  </item>`

/** One item at noon UTC on each day, `count` days running back from `latest`. */
const daily = (prefix: string, latest: string, count: number) =>
  Array.from({ length: count }, (_, index) => {
    const date = new Date(Date.parse(`${latest}T12:00:00.000Z`) - index * 86_400_000).toISOString()
    return item(`${prefix}-${date.slice(0, 10)}`, date)
  })

async function subscribe(service: TestService, user: Device, title: string, items: readonly string[]) {
  const url = `https://${title.toLowerCase().replaceAll(' ', '-')}.example/feed`
  service.upstream.stub(url, {
    headers: { 'content-type': 'application/rss+xml' },
    body: `<?xml version="1.0"?><rss version="2.0"><channel><title>${title}</title>${items.join('')}</channel></rss>`,
  })
  expect((await user.post('/api/subscriptions', { url })).status).toBe(201)
}

/** Field Notes publishes daily, Weekly Letters on five days, Old Almanac not for months. */
async function threeRhythms() {
  const service = await startTestService()
  const user = await claimedDevice(service)
  await subscribe(service, user, 'Field Notes', daily('notes', '2026-08-07', 20))
  await subscribe(service, user, 'Weekly Letters', [
    ...daily('letters', '2026-08-06', 3),
    item('letters-july', '2026-07-20T12:00:00.000Z'),
    item('letters-june', '2026-07-12T12:00:00.000Z'),
  ])
  await subscribe(service, user, 'Old Almanac', [item('almanac-may', '2026-05-01T12:00:00.000Z')])
  await service.wakeScheduler()
  return { service, user }
}

const digestOf = async (user: Device, query: string) =>
  digestSchema.parse(await (await user.get(`/api/digest?${query}`)).json())

const titles = (digest: { groups: readonly { items: readonly { title: string }[] }[] }) =>
  digest.groups.flatMap((group) => group.items.map(({ title }) => title))

describe('the Digest narrowed', () => {
  it('to the Feeds of one Rhythm, counting each day under the same narrowing', async () => {
    const { user } = await threeRhythms()

    const weekly = await digestOf(user, 'rhythm=weekly')
    expect(new Set(weekly.groups.flatMap((group) => group.items.map(({ feedTitle }) => feedTitle)))).toEqual(
      new Set(['Weekly Letters']),
    )
    expect(weekly.groups[0]).toMatchObject({ date: '2026-08-06', count: 1 })

    const inactive = await digestOf(user, 'rhythm=inactive')
    expect(titles(inactive)).toEqual(['almanac-may'])

    const everything = await digestOf(user, '')
    expect(everything.groups.find(({ date }) => date === '2026-08-06')?.count).toBe(2)
  })

  it('to one installation-timezone day', async () => {
    const service = await startTestService()
    const user = await claimedDevice(service)
    service.settings?.setTimezone('Pacific/Auckland', service.clock.now())
    await subscribe(service, user, 'Field Notes', [
      item('before-midnight', '2026-08-06T11:59:00.000Z'),
      item('after-midnight', '2026-08-06T12:00:00.000Z'),
      item('next-evening', '2026-08-07T11:00:00.000Z'),
      item('next-day', '2026-08-07T12:00:00.000Z'),
    ])
    await service.wakeScheduler()

    const day = await digestOf(user, 'day=2026-08-07')

    expect(titles(day)).toEqual(['next-evening', 'after-midnight'])
    expect(day.groups.map(({ date, count }) => [date, count])).toEqual([['2026-08-07', 2]])
  })

  it('to chosen Feeds, page after page', async () => {
    const service = await startTestService()
    const user = await claimedDevice(service)
    const minutes = (prefix: string, count: number) =>
      Array.from({ length: count }, (_, index) =>
        item(`${prefix}-${index}`, `2026-08-08T00:${String(index).padStart(2, '0')}:00.000Z`),
      )
    await subscribe(service, user, 'Field Notes', minutes('notes', 55))
    await subscribe(service, user, 'Weekly Letters', minutes('letters', 5))
    await service.wakeScheduler()

    const first = await digestOf(user, 'day=2026-08-08&feed=1')
    expect(first.groups[0]?.count).toBe(55)
    expect(first.nextCursor).toEqual(expect.any(String))

    const rest = await digestOf(user, `day=2026-08-08&feed=1&cursor=${encodeURIComponent(first.nextCursor ?? '')}`)
    expect(titles(rest)).toEqual(['notes-4', 'notes-3', 'notes-2', 'notes-1', 'notes-0'])
    expect(rest.nextCursor).toBeNull()

    const both = await digestOf(user, 'feed=1&feed=2')
    expect(both.groups[0]?.count).toBe(60)
  })

  it.each([['rhythm=hourly'], ['day=2026-02-30'], ['day=8 August'], ['feed=notes']])('refuses %s', async (query) => {
    const service = await startTestService()
    const user = await claimedDevice(service)

    const response = await user.get(`/api/digest?${query}`)

    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ error: { code: 'invalid_request' } })
  })
})

describe('the Digest calendar', () => {
  it('counts every day of the grid window across the whole Digest, today last', async () => {
    const { user } = await threeRhythms()

    const calendar = digestCalendarSchema.parse(await (await user.get('/api/digest/days')).json())
    expect(calendar.today).toBe('2026-08-08')
    expect(calendar.days.at(-1)).toEqual({ date: '2026-08-08', count: 0 })
    expect(calendar.days.length).toBeGreaterThan((CADENCE_GRID_WEEKS - 1) * 7)
    const count = (date: string) => calendar.days.find((day) => day.date === date)?.count
    expect(count('2026-08-06')).toBe(2)
    expect(count('2026-05-01')).toBe(1)

    expect(calendar.days.reduce((sum, day) => sum + day.count, 0)).toBe(26)
  })

  it('names the Feeds of one day, busiest first', async () => {
    const service = await startTestService()
    const user = await claimedDevice(service)
    await subscribe(service, user, 'Weekly Letters', [item('letter', '2026-08-07T10:00:00.000Z')])
    await subscribe(service, user, 'Field Notes', [
      item('morning', '2026-08-07T08:00:00.000Z'),
      item('evening', '2026-08-07T20:00:00.000Z'),
      item('today', '2026-08-08T08:00:00.000Z'),
    ])
    await subscribe(service, user, 'Almanac', [item('almanac', '2026-08-07T09:00:00.000Z')])
    await service.wakeScheduler()

    const day = digestDaySchema.parse(await (await user.get('/api/digest/days/2026-08-07')).json())

    expect(day).toEqual({
      date: '2026-08-07',
      feeds: [
        { feedId: 2, title: 'Field Notes', count: 2 },
        { feedId: 3, title: 'Almanac', count: 1 },
        { feedId: 1, title: 'Weekly Letters', count: 1 },
      ],
    })
    expect((await user.get('/api/digest/days/2026-13-01')).status).toBe(404)
  })
})

describe('the Digest by Feed', () => {
  it('gives each Subscription its three newest items, the most recently published Feed first', async () => {
    const { service, user } = await threeRhythms()
    await subscribe(service, user, 'Quiet Pages', [])
    await service.wakeScheduler()

    const byFeed = digestFeedsSchema.parse(await (await user.get('/api/digest/feeds')).json())

    expect(byFeed.today).toBe('2026-08-08')
    expect(byFeed.feeds.map(({ title, items }) => [title, items.map((entry) => entry.title)])).toEqual([
      ['Field Notes', ['notes-2026-08-07', 'notes-2026-08-06', 'notes-2026-08-05']],
      ['Weekly Letters', ['letters-2026-08-06', 'letters-2026-08-05', 'letters-2026-08-04']],
      ['Old Almanac', ['almanac-may']],
      ['Quiet Pages', []],
    ])
    expect(byFeed.feeds[0]?.items[0]).toMatchObject({ date: '2026-08-07', displayTime: '12:00', saved: false })
    expect(byFeed.feeds[0]?.cadence.filter((count) => count > 0)).toHaveLength(20)
  })
})
