import {
  FEED_UNAVAILABLE_AFTER_FAILURES,
  type FeedAvailability,
  type FeedAvailabilityCategory,
  type PollingIntervalMinutes,
} from '../../shared/api.js'
import type { FeedDocumentError } from '../ingestion/feed-document.js'
import type { LogFields } from '../logger.js'
import type { subscriptions } from '../persistence/schema.js'
import type { RetrievalFailure } from '../upstream/retrieval.js'
import { loggableUrl } from './loggable-url.js'
import { nextPollTime, nextRetryTime } from './polling-schedule.js'

/** What settling an attempt needs to know about the Feed that was just polled. */
export interface PolledFeed {
  readonly feedId: number
  readonly resolvedUrl: string
  readonly pollingIntervalMinutes: PollingIntervalMinutes
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

/** A poll that reached its verdict: the Feed answered — well or badly — or this installation never asked. */
export type SettledPoll = { readonly kind: 'updated' } | { readonly kind: 'not-modified' } | FailedPoll

type SubscriptionRow = typeof subscriptions.$inferSelect

/** The `subscriptions` columns one settled poll rewrites; every attempt moves the schedule. */
export type AvailabilityPatch = Pick<SubscriptionRow, 'nextPollAt' | 'lastPolledAt'> &
  Partial<Pick<SubscriptionRow, 'lastSuccessAt' | 'consecutiveFailures' | 'lastFailureCategory'>>

export interface Settlement {
  readonly patch: AvailabilityPatch
  /** Absent for a success, which the poll's own ingestion record already tells. */
  readonly log?: { readonly level: 'info' | 'warn'; readonly message: string; readonly fields: LogFields }
}

/**
 * The Feed Availability rule, pure: what one poll outcome writes and logs.
 * A publisher that answered badly lengthens the wait without ever removing the
 * Subscription; a publisher this installation never asked (boundary saturated,
 * or the caller gave up) leaves Feed Availability untouched and moves one
 * Polling Interval on.
 */
export function settle(feed: PolledFeed, outcome: SettledPoll, now: Date): Settlement {
  const lastPolledAt = now.toISOString()
  if (outcome.kind === 'updated' || outcome.kind === 'not-modified') {
    return {
      patch: {
        nextPollAt: nextPollTime(feed.feedId, feed.pollingIntervalMinutes, now),
        lastPolledAt,
        lastSuccessAt: lastPolledAt,
        consecutiveFailures: 0,
        lastFailureCategory: null,
      },
    }
  }

  if (wasNeverAsked(outcome)) {
    return {
      patch: { nextPollAt: nextPollTime(feed.feedId, feed.pollingIntervalMinutes, now), lastPolledAt },
      log: {
        level: 'info',
        message: 'subscriptions.feed_poll_deferred',
        fields: { feedId: feed.feedId, resolvedUrl: loggableUrl(feed.resolvedUrl), code: outcome.failure.code },
      },
    }
  }

  const category = availabilityCategoryOf(outcome)
  const consecutiveFailures = feed.consecutiveFailures + 1
  const nextPollAt = nextRetryTime(feed.feedId, feed.pollingIntervalMinutes, consecutiveFailures, now)
  return {
    patch: { nextPollAt, lastPolledAt, consecutiveFailures, lastFailureCategory: category },
    log: {
      level: 'warn',
      message: 'subscriptions.feed_poll_failed',
      fields: {
        feedId: feed.feedId,
        resolvedUrl: loggableUrl(feed.resolvedUrl),
        category,
        consecutiveFailures,
        nextPollAt,
      },
    },
  }
}

/** True only where this installation refused the attempt, so the publisher was never contacted. */
function wasNeverAsked(outcome: FailedPoll): outcome is Extract<FailedPoll, { kind: 'retrieval-failed' }> {
  return (
    outcome.kind === 'retrieval-failed' && (outcome.failure.code === 'busy' || outcome.failure.code === 'cancelled')
  )
}

/**
 * Everything the network refused to answer collapses into `unreachable`; the
 * finer distinctions are transport detail the User cannot act on.
 */
function availabilityCategoryOf(outcome: FailedPoll): FeedAvailabilityCategory {
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
