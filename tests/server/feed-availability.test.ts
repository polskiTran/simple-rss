import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { MAX_FEED_SIZE_MIB, type FeedAvailability } from '../../src/shared/api.js'
import { createLogger } from '../../src/server/logger.js'
import { openDatabase, type SqliteDatabase } from '../../src/server/persistence/database.js'
import { InstallationSettingsStore } from '../../src/server/persistence/installation-settings.js'
import { applyMigrations } from '../../src/server/persistence/migrations.js'
import {
  MAX_BACKOFF_MINUTES,
  backoffMinutes,
  nextPollTime,
  nextRetryTime,
} from '../../src/server/subscriptions/polling-schedule.js'
import { FeedAvailabilityLedger } from '../../src/server/subscriptions/feed-availability.js'
import { FeedPoll } from '../../src/server/subscriptions/feed-poll.js'
import { SubscriptionService } from '../../src/server/subscriptions/subscription-service.js'
import type { Retrieval, RetrievalBytesResult, RetrievalFailureCode } from '../../src/server/upstream/retrieval.js'
import { Device, claimedDevice } from '../support/device.js'
import { ManualClock } from '../support/manual-clock.js'
import { makeTempDataDir } from '../support/temp-dir.js'
import { startTestService, type TestService } from '../support/service-harness.js'
import type { FixtureResponse } from '../support/upstream-fixtures.js'

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
  readonly lastFailureAt: string | null
  readonly consecutiveFailures: number
  readonly lastFailureCategory: string | null
}

function storedAvailability(service: TestService, feedId: number): StoredAvailability {
  if (!service.database) throw new Error('the service started without a database')
  return storedAvailabilityIn(service.database, feedId)
}

function storedAvailabilityIn(database: SqliteDatabase, feedId: number): StoredAvailability {
  const row = database
    .prepare(
      `SELECT next_poll_at          AS nextPollAt,
              last_polled_at        AS lastPolledAt,
              last_success_at       AS lastSuccessAt,
              last_failure_at       AS lastFailureAt,
              consecutive_failures  AS consecutiveFailures,
              last_failure_category AS lastFailureCategory
         FROM subscriptions WHERE feed_id = ?`,
    )
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
  it('backs off exponentially on repeated failures and never waits past 24 hours', async () => {
    const service = await startTestService()
    const user = await claimedDevice(service)
    const url = 'https://one.example/feed'
    const feedId = await subscribed(user, service, url)

    service.upstream.stub(url, { status: 500, headers: { 'content-type': 'text/plain' }, body: 'gone' })

    for (const failures of [1, 2, 3, 4, 5, 6]) {
      await pollWhenDue(service, feedId)
      const stored = storedAvailability(service, feedId)
      expect(stored.consecutiveFailures).toBe(failures)
      expect(stored.nextPollAt).toBe(nextRetryTime(feedId, 120, failures, service.clock.now()))
      expect(Date.parse(stored.nextPollAt) - service.clock.now().getTime()).toBeLessThanOrEqual(
        MAX_BACKOFF_MINUTES * 60_000,
      )
    }
    expect(backoffMinutes(120, 5)).toBe(MAX_BACKOFF_MINUTES)
    expect(backoffMinutes(120, 6)).toBe(MAX_BACKOFF_MINUTES)

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
      lastSuccessAt: START,
      consecutiveFailures: 3,
      category: 'http_error',
    })

    const digest = (await (await user.get('/api/digest')).json()) as {
      groups: { items: { title: string }[] }[]
    }
    expect(digest.groups.flatMap((group) => group.items.map((item) => item.title))).toEqual(['First light'])
    expect(service.database?.prepare('SELECT COUNT(*) AS count FROM subscriptions').get()).toEqual({ count: 1 })
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
      lastSuccessAt: service.clock.now().toISOString(),
      consecutiveFailures: 0,
      category: null,
    })
    expect(storedAvailability(service, feedId).nextPollAt).toBe(nextPollTime(feedId, 120, service.clock.now()))
    expect(storedAvailability(service, feedId).lastFailureAt).toBeNull()
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
      lastSuccessAt: START,
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
      lastSuccessAt: service.clock.now().toISOString(),
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

describe('congestion at the retrieval boundary', () => {
  function feedBytes(url: string): RetrievalBytesResult {
    return {
      ok: true,
      status: 200,
      url,
      contentType: 'application/rss+xml',
      charset: undefined,
      etag: undefined,
      lastModified: undefined,
      notModified: false,
      bytes: new TextEncoder().encode(rss('Field Notes')),
    }
  }

  it('defers the attempt without blaming the Feed when no retrieval slot was available', async () => {
    const clock = new ManualClock(START)
    const database = openDatabase(join(await makeTempDataDir(), 'availability.db'))
    applyMigrations(database, clock)
    const url = 'https://one.example/feed'
    const logger = createLogger({ level: 'debug', now: () => clock.now(), sink: () => {} })
    const subscriptions = new SubscriptionService({
      database,
      clock,
      settings: new InstallationSettingsStore(database),
      logger,
    })
    const poll = new FeedPoll({
      database,
      retrieval: scriptedRetrieval([
        feedBytes(url),
        { ok: false, code: 'http_error', reason: 'upstream answered 500', status: 500 },
        { ok: false, code: 'busy', reason: 'no retrieval slot available' },
        feedBytes(url),
      ]),
      clock,
      logger,
      subscriptions,
      availability: new FeedAvailabilityLedger({ database, clock, logger }),
    })

    try {
      expect(subscriptions.create(url).kind).toBe('created')
      await poll.ingest(1)

      clock.advance(60_000)
      await poll.ingest(1)
      expect(storedAvailabilityIn(database, 1)).toMatchObject({
        consecutiveFailures: 1,
        lastFailureCategory: 'http_error',
      })

      clock.advance(60_000)
      await poll.ingest(1)
      expect(storedAvailabilityIn(database, 1)).toMatchObject({
        consecutiveFailures: 1,
        lastFailureCategory: 'http_error',
        lastPolledAt: clock.now().toISOString(),
        nextPollAt: nextPollTime(1, 120, clock.now()),
      })

      clock.advance(60_000)
      await poll.ingest(1)
      expect(storedAvailabilityIn(database, 1)).toMatchObject({
        consecutiveFailures: 0,
        lastFailureCategory: null,
      })
    } finally {
      database.close()
    }
  })
})

describe('availability categories', () => {
  it('keeps timeout and the other retrieval failures distinguishable', async () => {
    const verdicts: readonly [RetrievalFailureCode, FeedAvailability['category']][] = [
      ['timeout', 'timeout'],
      ['body_timeout', 'timeout'],
      ['too_large', 'too_large'],
      ['unsupported_content_type', 'unsupported_content'],
      ['unsupported_content_encoding', 'unsupported_content'],
      ['http_error', 'http_error'],
      ['unresolvable_host', 'unreachable'],
      ['unavailable', 'unreachable'],
    ]

    const clock = new ManualClock(START)
    const database = openDatabase(join(await makeTempDataDir(), 'categories.db'))
    applyMigrations(database, clock)
    const logger = createLogger({ level: 'debug', now: () => clock.now(), sink: () => {} })
    const subscriptions = new SubscriptionService({
      database,
      clock,
      settings: new InstallationSettingsStore(database),
      logger,
    })
    const poll = new FeedPoll({
      database,
      retrieval: scriptedRetrieval(verdicts.map(([code]) => ({ ok: false, code, reason: '' }))),
      clock,
      logger,
      subscriptions,
      availability: new FeedAvailabilityLedger({ database, clock, logger }),
    })

    try {
      expect(subscriptions.create('https://one.example/feed').kind).toBe('created')
      for (const [code, category] of verdicts) {
        await poll.ingest(1)
        expect(storedAvailabilityIn(database, 1).lastFailureCategory, code).toBe(category)
        clock.advance(60_000)
      }
    } finally {
      database.close()
    }
  })
})
