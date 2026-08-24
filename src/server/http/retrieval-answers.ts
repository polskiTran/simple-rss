import type { Context } from 'hono'
import { RETRIEVAL_PROFILES, type RetrievalFailureCode, type RetrievalProfile } from '../upstream/retrieval.js'
import { NO_STORE } from './responses.js'

export interface FailureAnswer {
  readonly status: 400 | 413 | 415 | 502 | 504
  readonly code: string
  readonly message: string
}

/**
 * What was being retrieved. Three answers are prose it owns; the other three
 * only name a code, since their message is a limit the profile already sets.
 */
interface RetrievalSubject {
  /** Sentence subject of the size and timing messages: `'The Feed'`, `'The original page'`. */
  readonly noun: string
  readonly profile: RetrievalProfile
  readonly unsafeDestination: FailureAnswer
  readonly unsupportedContent: FailureAnswer
  readonly unreachable: FailureAnswer
  readonly tooLargeCode: string
  readonly timeoutCode: string
  readonly bodyTimeoutCode: string
}

/**
 * Sixteen transport outcomes collapse into the six a User can act on. Adding a
 * `RetrievalFailureCode` fails to compile here and nowhere else.
 */
function retrievalAnswers(subject: RetrievalSubject) {
  const { noun, profile, unsafeDestination, unsupportedContent, unreachable } = subject
  return {
    invalid_request: unsafeDestination,
    invalid_url: unsafeDestination,
    blocked_destination: unsafeDestination,
    invalid_redirect: unsafeDestination,
    too_many_redirects: unsafeDestination,
    redirect_loop: unsafeDestination,
    unsupported_content_type: unsupportedContent,
    unsupported_content_encoding: unsupportedContent,
    too_large: {
      status: 413,
      code: subject.tooLargeCode,
      message: `${noun} is larger than the ${Math.round(profile.maxBytes / (1024 * 1024))} MiB limit`,
    },
    timeout: {
      status: 504,
      code: subject.timeoutCode,
      message: `${noun} did not respond within ${Math.round(profile.timeoutMs / 1_000)} seconds`,
    },
    body_timeout: {
      status: 504,
      code: subject.bodyTimeoutCode,
      message: `${noun} did not finish downloading within ${Math.round(profile.bodyTimeoutMs / 1_000)} seconds`,
    },
    unresolvable_host: unreachable,
    http_error: unreachable,
    cancelled: unreachable,
    busy: unreachable,
    unavailable: unreachable,
  } satisfies Readonly<Record<RetrievalFailureCode, FailureAnswer>>
}

export const FEED_ANSWERS = retrievalAnswers({
  noun: 'The Feed',
  profile: RETRIEVAL_PROFILES.feed,
  unsafeDestination: {
    status: 400,
    code: 'invalid_feed_url',
    message: 'The Feed URL is not a safe retrieval destination',
  },
  unsupportedContent: { status: 415, code: 'unsupported_feed', message: 'The URL returned unsupported Feed content' },
  unreachable: { status: 502, code: 'feed_unreachable', message: 'The Feed could not be reached' },
  tooLargeCode: 'feed_too_large',
  timeoutCode: 'feed_timeout',
  bodyTimeoutCode: 'feed_body_timeout',
})

export const ARTICLE_ANSWERS = retrievalAnswers({
  noun: 'The original page',
  profile: RETRIEVAL_PROFILES.reader,
  unsafeDestination: {
    status: 400,
    code: 'article_link_unsafe',
    message: 'The original link is not a safe retrieval destination',
  },
  unsupportedContent: { status: 415, code: 'unsupported_article', message: 'The original page is not readable HTML' },
  unreachable: { status: 502, code: 'article_unreachable', message: 'The original page could not be reached' },
  tooLargeCode: 'article_too_large',
  timeoutCode: 'article_timeout',
  bodyTimeoutCode: 'article_body_timeout',
})

export function answer(c: Context, failure: FailureAnswer): Response {
  return c.json({ error: { code: failure.code, message: failure.message } }, failure.status, NO_STORE)
}
