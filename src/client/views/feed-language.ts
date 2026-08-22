import {
  MAX_FEED_SIZE_MIB,
  type FeedAvailability,
  type FeedAvailabilityCategory,
  type FeedProofFailureCode,
} from '../../shared/api.js'
import { ApiError } from '../api.js'

export const AVAILABILITY_COPY: Readonly<Record<FeedAvailabilityCategory, string>> = {
  unreachable: 'the feed cannot be reached',
  timeout: 'the feed is taking too long to respond',
  too_large: `the feed has grown past the ${MAX_FEED_SIZE_MIB} MiB limit`,
  unsupported_content: 'the URL no longer returns feed content',
  http_error: 'the publisher is answering with an error',
  invalid_feed: 'the feed is returning unusable XML',
}

type FailureCode = FeedProofFailureCode | 'invalid_feed_url' | 'duplicate_subscription'

export const FAILURE_COPY: Readonly<Record<FailureCode, string>> = {
  unreachable: 'that feed could not be reached',
  timeout: 'that feed took too long to respond',
  too_large: `that feed is larger than ${MAX_FEED_SIZE_MIB} MiB`,
  unsupported_content: 'that address does not return a feed',
  http_error: 'the publisher answered with an error',
  invalid_feed: 'that feed contains unusable XML',
  no_feed_found: 'no feed was found at that address',
  invalid_feed_url: 'that address is not a public web address',
  duplicate_subscription: 'already subscribed',
}

function isFailureCode(code: string): code is FailureCode {
  return Object.hasOwn(FAILURE_COPY, code)
}

export function subscriptionFailure(error: unknown): string {
  if (!(error instanceof ApiError)) return 'the feed could not be reached'
  return isFailureCode(error.code) ? FAILURE_COPY[error.code] : 'that feed could not be added'
}

export function firstCheckFailure(category: FeedAvailabilityCategory | null): string {
  return category ? FAILURE_COPY[category] : 'that feed could not be added'
}

export function retryFailure(error: unknown): string {
  if (!(error instanceof ApiError)) return 'still unavailable — the feed could not be retrieved'
  if (error.code === 'refresh_rate_limited') return 'checked a moment ago — wait a little before retrying'
  return isFailureCode(error.code)
    ? `still unavailable — ${FAILURE_COPY[error.code]}`
    : 'still unavailable — the feed could not be retrieved'
}

/** The one sentence an unavailable Feed gets, said the same in the list and on the Feed itself. */
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
