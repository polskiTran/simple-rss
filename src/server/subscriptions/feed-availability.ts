import {
  FEED_UNAVAILABLE_AFTER_FAILURES,
  type FeedAvailability,
  type FeedAvailabilityCategory,
  type PollingIntervalMinutes,
} from '../../shared/api.js'
import { dateKey } from '../calendar.js'
import type { FeedDocumentError } from '../ingestion/feed-document.js'
import type { LogFields } from '../logger.js'
import type { subscriptions } from '../persistence/schema.js'
import type { RetrievalFailure } from '../upstream/retrieval.js'
import { loggableUrl } from './loggable-url.js'
import { nextPollTime, nextRetryTime } from './polling-schedule.js'

export interface PolledFeed {
  readonly feedId: number
  readonly resolvedUrl: string
  readonly pollingIntervalMinutes: PollingIntervalMinutes
  readonly consecutiveFailures: number
}

export interface RecordedAvailability {
  readonly lastPolledAt: string | null
  readonly lastSuccessAt: string | null
  readonly consecutiveFailures: number
  readonly lastFailureCategory: FeedAvailabilityCategory | null
}

export type FailedPoll =
  | { readonly kind: 'retrieval-failed'; readonly failure: RetrievalFailure }
  | { readonly kind: 'invalid-feed'; readonly code: FeedDocumentError['code'] }

export type SettledPoll = { readonly kind: 'updated' } | { readonly kind: 'not-modified' } | FailedPoll

type SubscriptionRow = typeof subscriptions.$inferSelect

export type AvailabilityPatch = Pick<SubscriptionRow, 'nextPollAt' | 'lastPolledAt'> &
  Partial<Pick<SubscriptionRow, 'lastSuccessAt' | 'consecutiveFailures' | 'lastFailureCategory'>>

export interface Settlement {
  readonly patch: AvailabilityPatch
  readonly log?: { readonly level: 'info' | 'warn'; readonly message: string; readonly fields: LogFields }
}

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

function wasNeverAsked(outcome: FailedPoll): outcome is Extract<FailedPoll, { kind: 'retrieval-failed' }> {
  return outcome.kind === 'retrieval-failed' && outcome.failure.code === 'busy'
}

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

export function availabilityOf(record: RecordedAvailability, timezone: string): FeedAvailability {
  const { lastPolledAt, lastSuccessAt, consecutiveFailures, lastFailureCategory: category } = record
  const lastSuccessDate = lastSuccessAt === null ? null : dateKey(new Date(lastSuccessAt), timezone)
  if (consecutiveFailures >= FEED_UNAVAILABLE_AFTER_FAILURES) {
    if (lastPolledAt === null || category === null)
      throw new Error('A failure run was recorded without its poll or its category')
    return { state: 'unavailable', lastCheckedAt: lastPolledAt, lastSuccessDate, consecutiveFailures, category }
  }
  if (lastSuccessDate === null) {
    return { state: 'unchecked', lastCheckedAt: lastPolledAt, lastSuccessDate, consecutiveFailures, category }
  }
  if (lastPolledAt === null) throw new Error('A success was recorded without its poll')
  return { state: 'available', lastCheckedAt: lastPolledAt, lastSuccessDate, consecutiveFailures, category }
}
