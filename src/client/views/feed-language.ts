import {
  MAX_FEED_SIZE_MIB,
  type ApiErrorCode,
  type FeedAvailability,
  type FeedAvailabilityCategory,
} from '../../shared/api.js'
import { hasOwn } from '../../shared/record.js'
import { ApiError } from '../api.js'
import { dayAndMonth } from '../day-names.js'

const AVAILABILITY_COPY = {
  unreachable: 'The feed can’t be reached',
  timeout: 'The feed is taking too long to respond',
  too_large: `The feed has grown past the ${MAX_FEED_SIZE_MIB} MiB limit`,
  unsupported_content: 'The address no longer returns a feed',
  http_error: 'The publisher is answering with an error',
  invalid_feed: 'The feed is returning unusable XML',
} satisfies Readonly<Record<FeedAvailabilityCategory, string>>

/** The Add feed field's answer to a line that is no address at all. */
export const NOT_AN_ADDRESS = 'Enter a site or feed address, like lowtechmagazine.com.'

const SUBSCRIPTION_FAILURE_COPY = {
  duplicate_subscription: 'Already subscribed.',
  invalid_feed_url: NOT_AN_ADDRESS,
  feed_too_large: `That feed is larger than ${MAX_FEED_SIZE_MIB} MiB.`,
  unsupported_feed: 'That address doesn’t return RSS or Atom.',
  malformed_feed: 'That feed contains malformed XML.',
  feed_timeout: 'That feed took too long to respond.',
  feed_body_timeout: 'That feed took too long to download.',
  feed_unreachable: 'That feed couldn’t be reached.',
} as const satisfies Partial<Record<ApiErrorCode, string>>

/** What the address's host failed to do, when it never gave an answer to read. */
const UNANSWERED_COPY = {
  feed_unreachable: 'couldn’t be reached.',
  feed_timeout: 'took too long to respond.',
  feed_body_timeout: 'took too long to download.',
} as const satisfies Partial<Record<ApiErrorCode, string>>

/**
 * Why the Add feed dialog has nothing to subscribe to at `host` — a lookup or
 * a Subscribe refused — and whether trying again could help: a retrieval that
 * failed may answer next time, an address that is no address never will.
 */
export function addFailure(cause: unknown, host: string) {
  const code = cause instanceof ApiError ? cause.code : 'feed_unreachable'
  if (code === 'invalid_feed_url' || code === 'duplicate_subscription') {
    return { reason: SUBSCRIPTION_FAILURE_COPY[code], retry: false }
  }
  const reason = hasOwn(UNANSWERED_COPY, code)
    ? `${host} ${UNANSWERED_COPY[code]}`
    : hasOwn(SUBSCRIPTION_FAILURE_COPY, code)
      ? SUBSCRIPTION_FAILURE_COPY[code]
      : 'That feed couldn’t be added.'
  return { reason: `${reason} Nothing was added.`, retry: true }
}

export function retryFailure(cause: unknown): string {
  if (!(cause instanceof ApiError)) return 'Still unavailable. The feed couldn’t be retrieved.'
  if (cause.code === 'refresh_rate_limited') return 'Checked a moment ago. Wait a little before retrying.'

  const code = cause.code
  const reason = hasOwn(SUBSCRIPTION_FAILURE_COPY, code) ? SUBSCRIPTION_FAILURE_COPY[code] : undefined
  return reason ? `Still unavailable. ${reason}` : 'Still unavailable. The feed couldn’t be retrieved.'
}

/** Why checking fails, when it last worked, and what stays: `… Last reached 5 Aug. Its items stay in your digest.` */
export function unavailableNote(availability: FeedAvailability): string {
  const reason = availability.category ? AVAILABILITY_COPY[availability.category] : 'Checking isn’t working'
  const lastSuccess = availability.lastSuccessDate
    ? `Last reached ${dayAndMonth(availability.lastSuccessDate)}.`
    : 'Not reached since subscribing.'

  return `${reason}. ${lastSuccess} Its items stay in your digest.`
}

/**
 * What the Add feed field sends: the address as typed, or a bare host given
 * `https://`. Anything else is no address at all, and is refused before any request.
 */
export function feedAddressOf(line: string): string | undefined {
  const address = line.trim()
  if (/^https?:\/\/\S+$/i.test(address)) return address
  if (/^[\w-]+(\.[\w-]+)+(:\d+)?(\/\S*)?$/.test(address)) return `https://${address}`
  return undefined
}
