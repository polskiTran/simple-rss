import type { FeedAvailabilityCategory } from '../../shared/api.js'
import { ApiError } from '../api.js'

/**
 * The calm words both Feed screens use for retrieval going wrong. One map per
 * failure vocabulary, so the list and the opened Feed cannot describe the same
 * outcome two ways.
 */

/** One calm phrase per safe failure category the server records. */
export const AVAILABILITY_COPY: Readonly<Record<FeedAvailabilityCategory, string>> = {
  unreachable: 'the feed cannot be reached',
  timeout: 'the feed is taking too long to respond',
  too_large: 'the feed has grown past the 2 MiB limit',
  unsupported_content: 'the URL no longer returns feed content',
  http_error: 'the publisher is answering with an error',
  invalid_feed: 'the feed is returning unusable XML',
}

export const SUBSCRIPTION_FAILURE_COPY: Readonly<Record<string, string>> = {
  duplicate_subscription: 'already subscribed',
  invalid_feed_url: 'enter an exact RSS or Atom URL',
  feed_too_large: 'that Feed is larger than 2 MiB',
  unsupported_feed: 'that URL does not return supported RSS or Atom',
  malformed_feed: 'that Feed contains malformed XML',
  feed_timeout: 'that Feed took too long to respond',
  feed_unreachable: 'that Feed could not be reached',
}

export function subscriptionFailure(error: unknown): string {
  if (!(error instanceof ApiError)) return 'the Feed could not be reached'
  return SUBSCRIPTION_FAILURE_COPY[error.code] ?? 'that Feed could not be added'
}

/** A retry that did not work explains itself as quietly as any other failure. */
export function retryFailure(error: unknown): string {
  if (!(error instanceof ApiError)) return 'still unavailable — the feed could not be retrieved'
  if (error.code === 'refresh_rate_limited') return 'checked a moment ago — wait a little before retrying'

  const reason = SUBSCRIPTION_FAILURE_COPY[error.code]
  return reason ? `still unavailable — ${reason}` : 'still unavailable — the feed could not be retrieved'
}

export function noteDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}
