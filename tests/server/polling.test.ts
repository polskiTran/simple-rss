import { describe, expect, it, vi } from 'vitest'
import { nextPollTime } from '../../src/server/subscriptions/polling-schedule.js'
import { Device, claimedDevice } from '../support/device.js'
import { startTestService, type TestService } from '../support/service-harness.js'

const START = '2026-08-08T09:00:00.000Z'
const HOUR_MS = 60 * 60_000

interface FeedItemFixture {
  readonly guid: string
  readonly title: string
  readonly pubDate?: string
}

function rss(title: string, items: readonly FeedItemFixture[]): string {
  const entries = items
    .map(
      (item) => `
    <item>
      <guid isPermaLink="false">${item.guid}</guid>
      <title>${item.title}</title>
      <link>https://journal.example/${item.guid}</link>
      ${item.pubDate ? `<pubDate>${item.pubDate}</pubDate>` : ''}
    </item>`,
    )
    .join('')
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel><title>${title}</title><link>https://journal.example/</link>${entries}</channel></rss>`
}

const FEED_HEADERS = { 'content-type': 'application/rss+xml; charset=utf-8' }

/** Subscribes the User to `url`, answering with the given document. */
async function subscribed(
  user: Device,
  service: TestService,
  url: string,
  xml: string,
  headers: Record<string, string> = {},
): Promise<number> {
  service.upstream.stub(url, { headers: { ...FEED_HEADERS, ...headers }, body: xml })
  const response = await user.post('/api/subscriptions', { url })
  expect(response.status).toBe(201)
  await service.wakeScheduler()
  const body = (await response.json()) as { subscription: { feedId: number } }
  return body.subscription.feedId
}

interface StoredSchedule {
  readonly pollingIntervalMinutes: number
  readonly nextPollAt: string
  readonly lastPolledAt: string | null
}

/** The persisted schedule, read the way the scheduler itself reads it. */
function scheduleOf(service: TestService, feedId: number): StoredSchedule {
  const row = service.database
    ?.prepare(
      `SELECT polling_interval_minutes AS pollingIntervalMinutes,
              next_poll_at            AS nextPollAt,
              last_polled_at          AS lastPolledAt
         FROM subscriptions WHERE feed_id = ?`,
    )
    .get(feedId)
  if (!row) throw new Error(`no subscription for feed ${feedId}`)
  return row as StoredSchedule
}

/** A Feed body the test holds open, to keep its retrieval slot occupied. */
function heldBody(xml: string): { body: ReadableStream<Uint8Array>; release: () => void } {
  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      await gate
      controller.enqueue(new TextEncoder().encode(xml))
      controller.close()
    },
  })
  return { body, release }
}

describe('background polling', () => {
  it('polls a due Subscription and its additions and corrections reach the Digest on another device', async () => {
    const service = await startTestService()
    const user = await claimedDevice(service)
    const url = 'https://one.example/feed'
    await subscribed(user, service, url, rss('Field Notes', [
      { guid: 'entry-1', title: 'First light', pubDate: 'Fri, 08 Aug 2026 07:15:00 GMT' },
    ]))

    // The initial import counts as a poll: due one interval plus jitter later.
    const created = scheduleOf(service, 1)
    expect(created.pollingIntervalMinutes).toBe(120)
    expect(created.nextPollAt).toBe(nextPollTime(1, 120, new Date(START)))

    // Before the due time nothing is polled.
    await service.wakeScheduler()
    expect(service.upstream.requestsTo(url)).toHaveLength(1)

    // The publisher corrects one title and adds an entry while nobody browses.
    service.upstream.stub(url, {
      headers: FEED_HEADERS,
      body: rss('Field Notes', [
        { guid: 'entry-1', title: 'First light, revised', pubDate: 'Fri, 08 Aug 2026 07:15:00 GMT' },
        { guid: 'entry-2', title: 'Evening calm', pubDate: 'Fri, 08 Aug 2026 11:30:00 GMT' },
      ]),
    })
    service.clock.advance(3 * HOUR_MS)
    await service.wakeScheduler()
    expect(service.upstream.requestsTo(url)).toHaveLength(2)

    // A different signed-in device sees the background work in its Digest.
    const phone = new Device(service)
    await phone.signIn()
    const digest = (await (await phone.get('/api/digest')).json()) as {
      groups: { items: { title: string }[] }[]
    }
    const titles = digest.groups.flatMap((group) => group.items.map((item) => item.title))
    expect(titles).toEqual(['Evening calm', 'First light, revised'])

    const polled = scheduleOf(service, 1)
    expect(polled.nextPollAt).toBe(nextPollTime(1, 120, service.clock.now()))
    expect(polled.lastPolledAt).toBe(service.clock.now().toISOString())
  })

  it('asks conditionally and a not-modified answer advances scheduling without rewriting Feed Items', async () => {
    const service = await startTestService()
    const user = await claimedDevice(service)
    const url = 'https://one.example/feed'
    const xml = rss('Field Notes', [{ guid: 'entry-1', title: 'First light' }])

    let polls = 0
    service.upstream.stubDynamic(url, () => {
      polls += 1
      return polls === 1
        ? {
            headers: { ...FEED_HEADERS, etag: '"v1"', 'last-modified': 'Fri, 08 Aug 2026 07:00:00 GMT' },
            body: xml,
          }
        : { status: 304, headers: { etag: '"v2"' } }
    })
    const added = await user.post('/api/subscriptions', { url })
    expect(added.status).toBe(201)
    // The first check retrieves in full and stores the validators.
    await service.wakeScheduler()

    service.clock.advance(3 * HOUR_MS)
    await service.wakeScheduler()

    const conditional = service.upstream.requestsTo(url)[1]
    expect(conditional?.headers).toMatchObject({
      'if-none-match': '"v1"',
      'if-modified-since': 'Fri, 08 Aug 2026 07:00:00 GMT',
    })

    // The stored Feed Items are exactly as the first retrieval left them.
    const items = service.database
      ?.prepare('SELECT title, last_observed_at AS lastObservedAt FROM feed_items')
      .all()
    expect(items).toEqual([{ title: 'First light', lastObservedAt: START }])

    // Scheduling still moved on, and said so calmly.
    expect(scheduleOf(service, 1).nextPollAt).toBe(nextPollTime(1, 120, service.clock.now()))
    expect(service.logs).toContainEqual(expect.objectContaining({ message: 'subscriptions.feed_unchanged', feedId: 1 }))

    // The 304 rotated the ETag but stayed silent about Last-Modified; the next
    // poll presents the newest validator of each.
    service.clock.advance(3 * HOUR_MS)
    await service.wakeScheduler()
    expect(service.upstream.requestsTo(url)[2]?.headers).toMatchObject({
      'if-none-match': '"v2"',
      'if-modified-since': 'Fri, 08 Aug 2026 07:00:00 GMT',
    })
  })

  it('changes one Subscription’s Polling Interval and recomputes the next due time predictably', async () => {
    const service = await startTestService()
    const user = await claimedDevice(service)
    const url = 'https://one.example/feed'
    await subscribed(user, service, url, rss('Field Notes', [{ guid: 'entry-1', title: 'First light' }]))

    // The next due time is anchored on the last completed poll — here the
    // initial import — so the same change always lands on the same instant.
    const shortened = await user.put('/api/feeds/1/interval', { pollingIntervalMinutes: 30 })
    expect(shortened.status).toBe(200)
    expect(await shortened.json()).toEqual({
      pollingIntervalMinutes: 30,
      nextPollAt: nextPollTime(1, 30, new Date(START)),
    })

    const repeated = await user.put('/api/feeds/1/interval', { pollingIntervalMinutes: 30 })
    expect(await repeated.json()).toEqual({
      pollingIntervalMinutes: 30,
      nextPollAt: nextPollTime(1, 30, new Date(START)),
    })

    const daily = await user.put('/api/feeds/1/interval', { pollingIntervalMinutes: 1440 })
    expect(await daily.json()).toEqual({
      pollingIntervalMinutes: 1440,
      nextPollAt: nextPollTime(1, 1440, new Date(START)),
    })
    expect(scheduleOf(service, 1).pollingIntervalMinutes).toBe(1440)

    // Only the presets exist; there is no free-form schedule to mistype.
    expect((await user.put('/api/feeds/1/interval', { pollingIntervalMinutes: 45 })).status).toBe(400)
    expect((await user.put('/api/feeds/999/interval', { pollingIntervalMinutes: 30 })).status).toBe(404)
    const visitor = new Device(service)
    expect((await visitor.put('/api/feeds/1/interval', { pollingIntervalMinutes: 30 })).status).toBe(401)

    // The shortened interval is what the scheduler actually honours.
    await user.put('/api/feeds/1/interval', { pollingIntervalMinutes: 30 })
    service.clock.advance(35 * 60_000)
    await service.wakeScheduler()
    expect(service.upstream.requestsTo(url)).toHaveLength(2)
    expect(scheduleOf(service, 1).pollingIntervalMinutes).toBe(30)
  })

  it('spreads Subscriptions sharing a preset and keeps their schedules across restarts', async () => {
    const service = await startTestService()
    const user = await claimedDevice(service)
    await subscribed(user, service, 'https://one.example/feed', rss('One', [{ guid: 'a', title: 'A' }]))
    await subscribed(user, service, 'https://two.example/feed', rss('Two', [{ guid: 'b', title: 'B' }]))

    const [first, second] = [scheduleOf(service, 1), scheduleOf(service, 2)]
    expect(first.nextPollAt).not.toBe(second.nextPollAt)

    await service.restart()
    expect(scheduleOf(service, 1)).toEqual(first)
    expect(scheduleOf(service, 2)).toEqual(second)
  })

  it('catches up Subscriptions that fell due while the service was down', async () => {
    const service = await startTestService()
    const user = await claimedDevice(service)
    const url = 'https://one.example/feed'
    await subscribed(user, service, url, rss('Field Notes', [{ guid: 'entry-1', title: 'First light' }]))

    // The container is replaced and a whole day passes before it returns.
    service.clock.advance(26 * HOUR_MS)
    await service.restart()

    await service.wakeScheduler()
    expect(service.upstream.requestsTo(url)).toHaveLength(2)
    expect(scheduleOf(service, 1).nextPollAt).toBe(nextPollTime(1, 120, service.clock.now()))
  })

  it('drains every due Subscription in one wake, oldest frontier first, batch by batch', async () => {
    const service = await startTestService({ scheduling: { batchLimit: 2 } })
    const user = await claimedDevice(service)
    const urls = ['https://one.example/feed', 'https://two.example/feed', 'https://three.example/feed']
    for (const [index, url] of urls.entries()) {
      await subscribed(user, service, url, rss(`Feed ${index}`, [{ guid: 'a', title: 'A' }]))
    }
    await user.put('/api/feeds/1/interval', { pollingIntervalMinutes: 30 })
    await user.put('/api/feeds/2/interval', { pollingIntervalMinutes: 60 })

    service.clock.advance(3 * HOUR_MS)
    await service.wakeScheduler()

    for (const url of urls) expect(service.upstream.requestsTo(url)).toHaveLength(2)
    // The two most-overdue Feeds filled the first batch; the third followed
    // in the same wake once that batch was done.
    const polled = service.upstream.requests.slice(-3).map((request) => request.url)
    expect([...polled.slice(0, 2)].sort()).toEqual([urls[0]!, urls[1]!].sort())
    expect(polled[2]).toBe(urls[2]!)
  })

  it('keeps no more than four Feed retrievals in flight at once', async () => {
    const service = await startTestService()
    const user = await claimedDevice(service)
    const urls = Array.from({ length: 6 }, (_, index) => `https://feed${index + 1}.example/feed`)
    for (const url of urls) {
      await subscribed(user, service, url, rss(url, [{ guid: 'a', title: 'A' }]))
    }
    const creations = service.upstream.requests.length

    const held = urls.map((url) => {
      const { body, release } = heldBody(rss(url, [{ guid: 'a', title: 'A' }]))
      service.upstream.stub(url, { headers: FEED_HEADERS, body })
      return release
    })

    service.clock.advance(3 * HOUR_MS)
    const wake = service.wakeScheduler()

    await vi.waitFor(() => expect(service.upstream.requests.length).toBe(creations + 4))
    // Give an over-eager fifth retrieval every chance to appear before ruling it out.
    await new Promise((resolve) => setTimeout(resolve, 25))
    expect(service.upstream.requests.length).toBe(creations + 4)

    for (const release of held) release()
    await wake
    expect(service.upstream.requests.length).toBe(creations + 6)
  })

  it('coalesces a manual refresh with the running poll and never changes the Polling Interval', async () => {
    const service = await startTestService()
    const user = await claimedDevice(service)
    const url = 'https://one.example/feed'
    await subscribed(user, service, url, rss('Field Notes', [{ guid: 'entry-1', title: 'First light' }]))

    const { body, release } = heldBody(rss('Field Notes', [{ guid: 'entry-1', title: 'First light' }]))
    service.upstream.stub(url, { headers: FEED_HEADERS, body })
    service.clock.advance(3 * HOUR_MS)

    const wake = service.wakeScheduler()
    await vi.waitFor(() => expect(service.upstream.requestsTo(url)).toHaveLength(2))

    // The User presses refresh while the scheduled poll is still in flight:
    // one retrieval serves both, and the schedule is simply the poll's.
    const refreshed = user.post('/api/feeds/1/refresh')
    await new Promise((resolve) => setTimeout(resolve, 25))
    expect(service.upstream.requestsTo(url)).toHaveLength(2)

    release()
    await wake
    const response = await refreshed
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ observedItems: 1 })

    const schedule = scheduleOf(service, 1)
    expect(schedule.pollingIntervalMinutes).toBe(120)
    expect(schedule.nextPollAt).toBe(nextPollTime(1, 120, service.clock.now()))
  })
})
