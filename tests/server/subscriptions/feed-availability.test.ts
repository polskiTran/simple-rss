import { describe, expect, it } from 'vitest'
import { MAX_FEED_SIZE_MIB, type FeedAvailability } from '../../../src/shared/api.js'
import {
  availabilityOf as presented,
  settle,
  type PolledFeed,
  type Settlement,
} from '../../../src/server/subscriptions/feed-availability.js'
import type { Retrieval, RetrievalBytesResult, RetrievalFailureCode } from '../../../src/server/upstream/retrieval.js'
import { Device, claimedDevice } from '../../support/device.js'
import { ManualClock } from '../../support/manual-clock.js'
import { startTestService, type TestService } from '../../support/service-harness.js'
import type { FixtureResponse } from '../../support/upstream-fixtures.js'

const START = '2026-08-08T09:00:00.000Z'

const FEED_HEADERS = { 'content-type': 'application/rss+xml; charset=utf-8' }

function rss(title: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel><title>${title}</title><link>https://journal.example/</link>
  <item>
    <guid isPermaLink="false">entry-1</guid>
    <title>First light</title>
    <link>https://journal.example/entry-1</link>
    <pubDate>Fri, 08 Aug 2026 07:15:00 GMT</pubDate>
  </item>
</channel></rss>`
}

const NOW = new Date(START)

const polled: PolledFeed = {
  feedId: 7,
  resolvedUrl: 'https://one.example/feed?token=secret',
  pollingIntervalMinutes: 120,
  consecutiveFailures: 0,
}

function failedWith(code: RetrievalFailureCode) {
  return { kind: 'retrieval-failed', failure: { ok: false, code, reason: '' } } as const
}

function waitMinutes(settlement: Settlement): number {
  return (Date.parse(settlement.patch.nextPollAt) - NOW.getTime()) / 60_000
}

describe('settling a poll', () => {
  it.each(['updated', 'not-modified'] as const)('clears the failure run after an %s answer', (kind) => {
    const settlement = settle({ ...polled, consecutiveFailures: 4 }, { kind }, NOW)

    expect(settlement).toEqual({
      patch: {
        nextPollAt: expect.any(String),
        lastPolledAt: START,
        lastSuccessAt: START,
        consecutiveFailures: 0,
        lastFailureCategory: null,
      },
    })
    expect(waitMinutes(settlement)).toBeGreaterThanOrEqual(120)
    expect(waitMinutes(settlement)).toBeLessThan(132)
  })

  it('extends the failure run and doubles the wait from the Polling Interval', () => {
    const first = settle(polled, failedWith('http_error'), NOW)
    expect(first.patch).toMatchObject({
      lastPolledAt: START,
      consecutiveFailures: 1,
      lastFailureCategory: 'http_error',
    })
    expect(first.patch).not.toHaveProperty('lastSuccessAt')
    expect(waitMinutes(first)).toBeGreaterThanOrEqual(120)
    expect(waitMinutes(first)).toBeLessThan(132)

    const third = settle({ ...polled, consecutiveFailures: 2 }, failedWith('http_error'), NOW)
    expect(third.patch.consecutiveFailures).toBe(3)
    expect(waitMinutes(third)).toBeGreaterThanOrEqual(480)
    expect(waitMinutes(third)).toBeLessThan(495)
  })

  it('never waits longer than 24 hours, whatever the run or the interval', () => {
    expect(waitMinutes(settle({ ...polled, consecutiveFailures: 5 }, failedWith('timeout'), NOW))).toBe(24 * 60)
    expect(waitMinutes(settle({ ...polled, pollingIntervalMinutes: 1440 }, failedWith('timeout'), NOW))).toBe(24 * 60)
  })

  it.each(['busy', 'cancelled'] as const)(
    'moves one Polling Interval on without blaming the Feed when the attempt was %s',
    (code) => {
      const settlement = settle({ ...polled, consecutiveFailures: 2 }, failedWith(code), NOW)

      expect(settlement.patch).toEqual({ nextPollAt: expect.any(String), lastPolledAt: START })
      expect(waitMinutes(settlement)).toBeGreaterThanOrEqual(120)
      expect(waitMinutes(settlement)).toBeLessThan(132)
      expect(settlement.log).toEqual({
        level: 'info',
        message: 'subscriptions.feed_poll_deferred',
        fields: { feedId: 7, resolvedUrl: 'https://one.example/feed', code },
      })
    },
  )

  it.each([
    ['timeout', 'timeout'],
    ['body_timeout', 'timeout'],
    ['too_large', 'too_large'],
    ['unsupported_content_type', 'unsupported_content'],
    ['unsupported_content_encoding', 'unsupported_content'],
    ['http_error', 'http_error'],
    ['unresolvable_host', 'unreachable'],
    ['unavailable', 'unreachable'],
  ] as const)('records a %s failure as %s', (code, category) => {
    expect(settle(polled, failedWith(code), NOW).patch.lastFailureCategory).toBe(category)
  })

  it('records a document that would not parse as invalid_feed', () => {
    expect(settle(polled, { kind: 'invalid-feed', code: 'malformed_feed' }, NOW).patch.lastFailureCategory).toBe(
      'invalid_feed',
    )
  })

  it('logs a failure with the loggable Feed URL and the next attempt', () => {
    const settlement = settle(polled, failedWith('http_error'), NOW)
    expect(settlement.log).toEqual({
      level: 'warn',
      message: 'subscriptions.feed_poll_failed',
      fields: {
        feedId: 7,
        resolvedUrl: 'https://one.example/feed',
        category: 'http_error',
        consecutiveFailures: 1,
        nextPollAt: settlement.patch.nextPollAt,
      },
    })
  })
})

describe('presented Feed Availability', () => {
  const never = { lastPolledAt: null, lastSuccessAt: null, consecutiveFailures: 0, lastFailureCategory: null }

  it('is unchecked until a retrieval succeeds, failures or not', () => {
    expect(presented(never, 'UTC').state).toBe('unchecked')
    expect(
      presented({ ...never, lastPolledAt: START, consecutiveFailures: 2, lastFailureCategory: 'timeout' }, 'UTC').state,
    ).toBe('unchecked')
  })

  it('stays available through two failures and turns unavailable at the third', () => {
    const succeeded = { ...never, lastPolledAt: START, lastSuccessAt: START }
    expect(presented({ ...succeeded, consecutiveFailures: 2 }, 'UTC').state).toBe('available')
    expect(presented({ ...succeeded, consecutiveFailures: 3 }, 'UTC').state).toBe('unavailable')
    expect(presented({ ...never, consecutiveFailures: 3 }, 'UTC').state).toBe('unavailable')
  })

  it('names the last success by its day in the installation timezone', () => {
    const lateEvening = { ...never, lastPolledAt: START, lastSuccessAt: '2026-08-07T20:00:00.000Z' }
    expect(presented(lateEvening, 'UTC').lastSuccessDate).toBe('2026-08-07')
    expect(presented(lateEvening, 'Pacific/Auckland').lastSuccessDate).toBe('2026-08-08')
  })
})

async function subscribed(user: Device, service: TestService, url: string): Promise<number> {
  service.upstream.stub(url, { headers: FEED_HEADERS, body: rss('Field Notes') })
  const response = await user.post('/api/subscriptions', { url })
  expect(response.status).toBe(201)
  await service.wakeScheduler()
  const body = (await response.json()) as { subscription: { feedId: number } }
  return body.subscription.feedId
}

interface StoredAvailability {
  readonly nextPollAt: string
  readonly lastPolledAt: string | null
  readonly lastSuccessAt: string | null
  readonly consecutiveFailures: number
  readonly lastFailureCategory: string | null
}

function storedAvailability(service: TestService, feedId: number): StoredAvailability {
  const row = service.database.$client
    .prepare(`SELECT next_poll_at          AS nextPollAt,
          last_polled_at        AS lastPolledAt,
          last_success_at       AS lastSuccessAt,
          consecutive_failures  AS consecutiveFailures,
          last_failure_category AS lastFailureCategory
     FROM subscriptions WHERE feed_id = ?`)
    .get(feedId)
  if (!row) throw new Error(`no subscription for feed ${feedId}`)
  return row as StoredAvailability
}

async function pollWhenDue(service: TestService, feedId: number): Promise<void> {
  const due = Date.parse(storedAvailability(service, feedId).nextPollAt)
  service.clock.advance(Math.max(0, due - service.clock.now().getTime()))
  await service.wakeScheduler()
}

async function availabilityOf(user: Device, feedId: number): Promise<FeedAvailability> {
  const response = await user.get('/api/feeds')
  expect(response.status).toBe(200)
  const body = (await response.json()) as {
    subscriptions: { feedId: number; availability: FeedAvailability }[]
  }
  const subscription = body.subscriptions.find((entry) => entry.feedId === feedId)
  if (!subscription) throw new Error(`feed ${feedId} is not in the list`)
  return subscription.availability
}

describe('Feed Availability', () => {
  it('waits out the backoff between failed polls, never past 24 hours', async () => {
    const service = await startTestService()
    const user = await claimedDevice(service)
    const url = 'https://one.example/feed'
    const feedId = await subscribed(user, service, url)

    service.upstream.stub(url, { status: 500, headers: { 'content-type': 'text/plain' }, body: 'gone' })
    for (const failures of [1, 2, 3, 4, 5, 6]) {
      await pollWhenDue(service, feedId)
      expect(storedAvailability(service, feedId).consecutiveFailures).toBe(failures)
    }
    expect(Date.parse(storedAvailability(service, feedId).nextPollAt) - service.clock.now().getTime()).toBe(
      24 * 60 * 60_000,
    )

    const attempts = service.upstream.requestsTo(url).length
    await service.wakeScheduler()
    expect(service.upstream.requestsTo(url)).toHaveLength(attempts)
  })

  it('surfaces calm Feed Availability after three failures and keeps the Subscription and its Feed Items', async () => {
    const service = await startTestService()
    const user = await claimedDevice(service)
    const url = 'https://one.example/feed'
    const feedId = await subscribed(user, service, url)

    service.upstream.stub(url, { status: 503, headers: { 'content-type': 'text/plain' }, body: '' })

    await pollWhenDue(service, feedId)
    await pollWhenDue(service, feedId)
    expect(await availabilityOf(user, feedId)).toMatchObject({
      state: 'available',
      consecutiveFailures: 2,
    })

    await pollWhenDue(service, feedId)
    expect(await availabilityOf(user, feedId)).toEqual({
      state: 'unavailable',
      lastCheckedAt: service.clock.now().toISOString(),
      lastSuccessDate: '2026-08-08',
      consecutiveFailures: 3,
      category: 'http_error',
    })

    const digest = (await (await user.get('/api/digest')).json()) as {
      groups: { items: { title: string }[] }[]
    }
    expect(digest.groups.flatMap((group) => group.items.map((item) => item.title))).toEqual(['First light'])
    expect(service.database.$client.prepare('SELECT COUNT(*) AS count FROM subscriptions').get()).toEqual({ count: 1 })
  })

  it('resets the failure state the moment a later scheduled poll succeeds', async () => {
    const service = await startTestService()
    const user = await claimedDevice(service)
    const url = 'https://one.example/feed'
    const feedId = await subscribed(user, service, url)

    service.upstream.stub(url, { status: 500, headers: { 'content-type': 'text/plain' }, body: '' })
    await pollWhenDue(service, feedId)
    await pollWhenDue(service, feedId)
    await pollWhenDue(service, feedId)

    service.upstream.stub(url, { headers: FEED_HEADERS, body: rss('Field Notes') })
    await pollWhenDue(service, feedId)

    expect(await availabilityOf(user, feedId)).toEqual({
      state: 'available',
      lastCheckedAt: service.clock.now().toISOString(),
      lastSuccessDate: service.clock.now().toISOString().slice(0, 10),
      consecutiveFailures: 0,
      category: null,
    })
  })

  it('keeps the failure run and its backoff across a restart', async () => {
    const service = await startTestService()
    const user = await claimedDevice(service)
    const url = 'https://one.example/feed'
    const feedId = await subscribed(user, service, url)

    service.upstream.stub(url, { status: 500, headers: { 'content-type': 'text/plain' }, body: '' })
    await pollWhenDue(service, feedId)
    await pollWhenDue(service, feedId)
    await pollWhenDue(service, feedId)
    const before = storedAvailability(service, feedId)

    await service.restart()

    expect(storedAvailability(service, feedId)).toEqual(before)
    const phone = new Device(service)
    await phone.signIn()
    expect(await availabilityOf(phone, feedId)).toMatchObject({
      state: 'unavailable',
      consecutiveFailures: 3,
      category: 'http_error',
      lastSuccessDate: '2026-08-08',
    })
  })

  it('lets a manual retry restore availability immediately, inside the refresh rate limit', async () => {
    const service = await startTestService()
    const user = await claimedDevice(service)
    const url = 'https://one.example/feed'
    const feedId = await subscribed(user, service, url)

    service.upstream.stub(url, { status: 500, headers: { 'content-type': 'text/plain' }, body: '' })
    await pollWhenDue(service, feedId)
    await pollWhenDue(service, feedId)
    await pollWhenDue(service, feedId)

    const tooSoon = await user.post(`/api/feeds/${feedId}/refresh`)
    expect(tooSoon.status).toBe(429)
    expect(Number(tooSoon.headers.get('retry-after'))).toBeGreaterThan(0)
    expect((await availabilityOf(user, feedId)).state).toBe('unavailable')

    service.upstream.stub(url, { headers: FEED_HEADERS, body: rss('Field Notes') })
    service.clock.advance(61_000)
    const retried = await user.post(`/api/feeds/${feedId}/refresh`)
    expect(retried.status).toBe(200)
    expect(await availabilityOf(user, feedId)).toMatchObject({
      state: 'available',
      consecutiveFailures: 0,
      category: null,
      lastSuccessDate: service.clock.now().toISOString().slice(0, 10),
    })
  })

  it('keeps liveness and readiness untouched while Feeds fail', async () => {
    const service = await startTestService()
    const user = await claimedDevice(service)
    const url = 'https://one.example/feed'
    const feedId = await subscribed(user, service, url)

    service.upstream.stub(url, { status: 500, headers: { 'content-type': 'text/plain' }, body: '' })
    await pollWhenDue(service, feedId)
    await pollWhenDue(service, feedId)
    await pollWhenDue(service, feedId)

    expect(await (await service.fetch('/health/live')).json()).toEqual({ status: 'live' })
    expect(await (await service.fetch('/health/ready')).json()).toEqual({ status: 'ready' })
  })

  it('records each failure mode as its own safe category', async () => {
    const service = await startTestService()
    const user = await claimedDevice(service)

    const modes: readonly {
      readonly url: string
      readonly respond: () => FixtureResponse
      readonly category: string
    }[] = [
      {
        url: 'https://http.example/feed',
        respond: () => ({ status: 500, headers: { 'content-type': 'text/plain' }, body: '' }),
        category: 'http_error',
      },
      {
        url: 'https://mime.example/feed',
        respond: () => ({ headers: { 'content-type': 'text/html' }, body: '<html></html>' }),
        category: 'unsupported_content',
      },
      {
        url: 'https://size.example/feed',
        respond: () => ({
          headers: { ...FEED_HEADERS, 'content-length': String((MAX_FEED_SIZE_MIB + 1) * 1024 * 1024) },
          body: '',
        }),
        category: 'too_large',
      },
      {
        url: 'https://parse.example/feed',
        respond: () => ({ headers: FEED_HEADERS, body: 'not a feed at all' }),
        category: 'invalid_feed',
      },
      {
        url: 'https://network.example/feed',
        respond: () => {
          throw new Error('connection reset by peer')
        },
        category: 'unreachable',
      },
    ]

    const feedIds = new Map<string, number>()
    for (const mode of modes) {
      feedIds.set(mode.url, await subscribed(user, service, mode.url))
    }
    for (const mode of modes) {
      service.upstream.stubDynamic(mode.url, mode.respond)
    }

    service.clock.advance(3 * 60 * 60_000)
    await service.wakeScheduler()

    for (const mode of modes) {
      const stored = storedAvailability(service, feedIds.get(mode.url)!)
      expect(stored.lastFailureCategory, mode.url).toBe(mode.category)
      expect(stored.consecutiveFailures, mode.url).toBe(1)
    }
  })

  it('logs safe poll outcomes without Feed content or sensitive query strings', async () => {
    const service = await startTestService()
    const user = await claimedDevice(service)
    const url = 'https://one.example/feed?token=super-secret-value'
    const feedId = await subscribed(user, service, url)

    service.upstream.stub(url, { status: 500, headers: { 'content-type': 'text/plain' }, body: '' })
    await pollWhenDue(service, feedId)

    const failure = service.logs.find((record) => record.message === 'subscriptions.feed_poll_failed')
    expect(failure).toMatchObject({
      feedId,
      resolvedUrl: 'https://one.example/feed',
      category: 'http_error',
      consecutiveFailures: 1,
    })

    const everything = JSON.stringify(service.logs)
    expect(everything).not.toContain('super-secret-value')
    expect(everything).not.toContain('First light')
  })
})

function scriptedRetrieval(script: RetrievalBytesResult[]): Retrieval {
  return {
    retrieve: () => Promise.reject(new Error('these polls buffer, they never stream')),
    retrieveBytes: async () => {
      const next = script.shift()
      if (!next) throw new Error('the retrieval script ran out of answers')
      return next
    },
  }
}

/** Subscribes without polling, so each scheduler wake spends the next scripted answer. */
async function subscribedOnScript(service: TestService, url: string): Promise<number> {
  const user = await claimedDevice(service)
  const response = await user.post('/api/subscriptions', { url })
  expect(response.status).toBe(201)
  const body = (await response.json()) as { subscription: { feedId: number } }
  return body.subscription.feedId
}

describe('congestion at the retrieval boundary', () => {
  function feedBytes(url: string): RetrievalBytesResult {
    return {
      ok: true,
      status: 200,
      url,
      contentType: 'application/rss+xml',
      charset: undefined,
      etag: null,
      lastModified: null,
      notModified: false,
      bytes: new TextEncoder().encode(rss('Field Notes')),
    }
  }

  it('defers the attempt without blaming the Feed when no retrieval slot was available', async () => {
    const url = 'https://one.example/feed'
    const service = await startTestService({
      clock: new ManualClock(START),
      retrieval: scriptedRetrieval([
        feedBytes(url),
        { ok: false, code: 'http_error', reason: 'upstream answered 500', status: 500 },
        { ok: false, code: 'busy', reason: 'no retrieval slot available' },
        feedBytes(url),
      ]),
    })
    const feedId = await subscribedOnScript(service, url)
    await service.wakeScheduler()

    await pollWhenDue(service, feedId)
    expect(storedAvailability(service, feedId)).toMatchObject({
      consecutiveFailures: 1,
      lastFailureCategory: 'http_error',
    })

    await pollWhenDue(service, feedId)
    expect(storedAvailability(service, feedId)).toMatchObject({
      consecutiveFailures: 1,
      lastFailureCategory: 'http_error',
      lastPolledAt: service.clock.now().toISOString(),
    })

    await pollWhenDue(service, feedId)
    expect(storedAvailability(service, feedId)).toMatchObject({
      consecutiveFailures: 0,
      lastFailureCategory: null,
    })
  })
})
