import { eq } from 'drizzle-orm'
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import {
  FEED_UNAVAILABLE_AFTER_FAILURES,
  type FeedAvailability,
  type FeedAvailabilityCategory,
} from '../../shared/api.js'
import type { Clock } from '../clock.js'
import type { FeedDocumentError } from '../ingestion/feed-document.js'
import type { Logger } from '../logger.js'
import type { SqliteDatabase } from '../persistence/database.js'
import { subscriptions } from '../persistence/schema.js'
import type { RetrievalFailure } from '../upstream/retrieval.js'
import { loggableUrl } from './loggable-url.js'
import { nextPollTime, nextRetryTime } from './polling-schedule.js'

/** What recording an attempt needs to know about the Feed that was just polled. */
export interface PolledFeed {
  readonly feedId: number
  readonly resolvedUrl: string
  readonly pollingIntervalMinutes: number
  readonly consecutiveFailures: number
}

/** Feed Availability as the `subscriptions` row holds it. Nothing is kept in memory. */
export interface RecordedAvailability {
  readonly lastPolledAt: string | null
  readonly lastSuccessAt: string | null
  readonly consecutiveFailures: number
  readonly lastFailureCategory: FeedAvailabilityCategory | null
}

/** The two ways a poll ends badly: the boundary refused, or the document would not parse. */
export type FailedPoll =
  | { readonly kind: 'retrieval-failed'; readonly failure: RetrievalFailure }
  | { readonly kind: 'invalid-feed'; readonly code: FeedDocumentError['code'] }

/**
 * Every write to a Subscription's Feed Availability, and the distinction that
 * makes them three methods rather than two: a publisher that answered badly is
 * not a publisher we never asked.
 */
export class FeedAvailabilityLedger {
  readonly #db: BetterSQLite3Database
  readonly #clock: Clock
  readonly #logger: Logger

  constructor(options: { database: SqliteDatabase; clock: Clock; logger: Logger }) {
    this.#db = drizzle(options.database)
    this.#clock = options.clock
    this.#logger = options.logger.child({ component: 'subscriptions' })
  }

  recordSuccess(feed: PolledFeed): void {
    const now = this.#clock.now()
    this.#db
      .update(subscriptions)
      .set({
        nextPollAt: nextPollTime(feed.feedId, feed.pollingIntervalMinutes, now),
        lastPolledAt: now.toISOString(),
        lastSuccessAt: now.toISOString(),
        lastFailureAt: null,
        consecutiveFailures: 0,
        lastFailureCategory: null,
      })
      .where(eq(subscriptions.feedId, feed.feedId))
      .run()
  }

  /**
   * A failure only lengthens the wait; the User can retry by hand. The Subscription
   * survives — a failing Feed stays subscribed and its Feed Items stay in the Digest.
   */
  recordFailure(feed: PolledFeed, category: FeedAvailabilityCategory): void {
    const now = this.#clock.now()
    const consecutiveFailures = feed.consecutiveFailures + 1
    const nextPollAt = nextRetryTime(feed.feedId, feed.pollingIntervalMinutes, consecutiveFailures, now)
    this.#db
      .update(subscriptions)
      .set({
        nextPollAt,
        lastPolledAt: now.toISOString(),
        lastFailureAt: now.toISOString(),
        consecutiveFailures,
        lastFailureCategory: category,
      })
      .where(eq(subscriptions.feedId, feed.feedId))
      .run()

    this.#logger.warn('subscriptions.feed_poll_failed', {
      feedId: feed.feedId,
      resolvedUrl: loggableUrl(feed.resolvedUrl),
      category,
      consecutiveFailures,
      nextPollAt,
    })
  }

  /**
   * The publisher was never asked (boundary saturated, or the caller gave up), so
   * Feed Availability is left untouched and the attempt moves one Polling Interval on.
   */
  recordDeferral(feed: PolledFeed, code: RetrievalFailure['code']): void {
    const now = this.#clock.now()
    this.#db
      .update(subscriptions)
      .set({
        nextPollAt: nextPollTime(feed.feedId, feed.pollingIntervalMinutes, now),
        lastPolledAt: now.toISOString(),
      })
      .where(eq(subscriptions.feedId, feed.feedId))
      .run()

    this.#logger.info('subscriptions.feed_poll_deferred', {
      feedId: feed.feedId,
      resolvedUrl: loggableUrl(feed.resolvedUrl),
      code,
    })
  }
}

/** True only where this installation refused the attempt, so the publisher was never contacted. */
export function wasNeverAsked(outcome: FailedPoll): outcome is Extract<FailedPoll, { kind: 'retrieval-failed' }> {
  return (
    outcome.kind === 'retrieval-failed' && (outcome.failure.code === 'busy' || outcome.failure.code === 'cancelled')
  )
}

/**
 * Everything the network refused to answer collapses into `unreachable`; the
 * finer distinctions are transport detail the User cannot act on.
 */
export function availabilityCategoryOf(outcome: FailedPoll): FeedAvailabilityCategory {
  if (outcome.kind === 'invalid-feed') return 'invalid_feed'
  switch (outcome.failure.code) {
    case 'timeout':
    case 'body_timeout':
      return 'timeout'
    case 'too_large':
      return 'too_large'
    case 'unsupported_content_type':
    case 'unsupported_content_encoding':
      return 'unsupported_content'
    case 'http_error':
      return 'http_error'
    default:
      return 'unreachable'
  }
}

/** The presented state is derived from the stored run of failures, never stored itself. */
export function availabilityOf(record: RecordedAvailability): FeedAvailability {
  return {
    state:
      record.consecutiveFailures >= FEED_UNAVAILABLE_AFTER_FAILURES
        ? 'unavailable'
        : record.lastSuccessAt === null
          ? 'unchecked'
          : 'available',
    lastCheckedAt: record.lastPolledAt,
    lastSuccessAt: record.lastSuccessAt,
    consecutiveFailures: record.consecutiveFailures,
    category: record.lastFailureCategory,
  }
}
