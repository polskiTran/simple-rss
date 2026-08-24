import { MAX_FEED_SIZE_MIB, type FeedAvailability, type FeedAvailabilityCategory } from '../../shared/api.js'
import { hasOwn } from '../../shared/record.js'
import { ApiError } from '../api.js'

export const AVAILABILITY_COPY = {
  unreachable: 'the feed cannot be reached',
  timeout: 'the feed is taking too long to respond',
  too_large: `the feed has grown past the ${MAX_FEED_SIZE_MIB} MiB limit`,
  unsupported_content: 'the URL no longer returns feed content',
  http_error: 'the publisher is answering with an error',
  invalid_feed: 'the feed is returning unusable XML',
} satisfies Readonly<Record<FeedAvailabilityCategory, string>>

export const SUBSCRIPTION_FAILURE_COPY = {
  duplicate_subscription: 'already subscribed',
  invalid_feed_url: 'enter an exact RSS or Atom URL',
  feed_too_large: `that Feed is larger than ${MAX_FEED_SIZE_MIB} MiB`,
  unsupported_feed: 'that URL does not return supported RSS or Atom',
  malformed_feed: 'that Feed contains malformed XML',
  feed_timeout: 'that Feed took too long to respond',
  feed_body_timeout: 'that Feed took too long to download',
  feed_unreachable: 'that Feed could not be reached',
} as const satisfies Readonly<Record<string, string>>

export function subscriptionFailure(cause: unknown): string {
  if (!(cause instanceof ApiError)) return 'the Feed could not be reached'
  const code = cause.code
  return hasOwn(SUBSCRIPTION_FAILURE_COPY, code) ? SUBSCRIPTION_FAILURE_COPY[code] : 'that Feed could not be added'
}

const FIRST_CHECK_FAILURE_CODE = {
  unreachable: 'feed_unreachable',
  timeout: 'feed_timeout',
  too_large: 'feed_too_large',
  unsupported_content: 'unsupported_feed',
  http_error: 'feed_unreachable',
  invalid_feed: 'malformed_feed',
} satisfies Readonly<Record<FeedAvailabilityCategory, string>>

export function firstCheckFailure(category: FeedAvailabilityCategory | null): string {
  const code = category ? FIRST_CHECK_FAILURE_CODE[category] : undefined
  return code && hasOwn(SUBSCRIPTION_FAILURE_COPY, code)
    ? SUBSCRIPTION_FAILURE_COPY[code]
    : 'that Feed could not be added'
}

export function retryFailure(cause: unknown): string {
  if (!(cause instanceof ApiError)) return 'still unavailable — the feed could not be retrieved'
  if (cause.code === 'refresh_rate_limited') return 'checked a moment ago — wait a little before retrying'

  const code = cause.code
  const reason = hasOwn(SUBSCRIPTION_FAILURE_COPY, code) ? SUBSCRIPTION_FAILURE_COPY[code] : undefined
  return reason ? `still unavailable — ${reason}` : 'still unavailable — the feed could not be retrieved'
}

export function unavailableNote(availability: FeedAvailability): string {
  const reason = availability.category ? AVAILABILITY_COPY[availability.category] : 'checking is not working'
  const lastSuccess = availability.lastSuccessAt
    ? `last reached ${noteDate(availability.lastSuccessAt)}`
    : 'not reached since subscribing'

  return `${reason} — ${lastSuccess}. its items stay in your digest.`
}

export function noteDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}
