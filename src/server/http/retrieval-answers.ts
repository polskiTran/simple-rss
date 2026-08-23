import type { Context } from 'hono'
import type { FeedDocumentFailureCode } from '../ingestion/feed-document.js'
import { RETRIEVAL_PROFILES, type RetrievalFailureCode, type RetrievalProfile } from '../upstream/retrieval.js'
import { NO_STORE } from './responses.js'

export interface FailureAnswer {
  readonly status: 400 | 413 | 415 | 422 | 502 | 504
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
  readonly httpError?: FailureAnswer
  readonly tooLargeCode: string
  readonly timeoutCode: string
  readonly bodyTimeoutCode: string
}

/**
 * Sixteen transport outcomes collapse into the six a User can act on. Adding a
 * `RetrievalFailureCode` fails to compile here and nowhere else.
 */
function retrievalAnswers(subject: RetrievalSubject): Readonly<Record<RetrievalFailureCode, FailureAnswer>> {
  const { noun, profile, unsafeDestination, unsupportedContent, unreachable, httpError = unreachable } = subject
  const { deadline } = profile
  const bodyTimeoutMs = deadline.kind === 'split' ? deadline.bodyTimeoutMs : deadline.timeoutMs
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
      message: `${noun} did not respond within ${Math.round(deadline.timeoutMs / 1_000)} seconds`,
    },
    body_timeout: {
      status: 504,
      code: subject.bodyTimeoutCode,
      message: `${noun} did not finish downloading within ${Math.round(bodyTimeoutMs / 1_000)} seconds`,
    },
    unresolvable_host: unreachable,
    http_error: httpError,
    cancelled: unreachable,
    busy: unreachable,
    unavailable: unreachable,
  }
}

const FEED_SUBJECT = {
  noun: 'The Feed',
  unsafeDestination: {
    status: 400,
    code: 'invalid_feed_url',
    message: 'The Feed URL is not a safe retrieval destination',
  },
  unsupportedContent: { status: 415, code: 'unsupported_content', message: 'The URL did not return Feed content' },
  unreachable: { status: 502, code: 'unreachable', message: 'The Feed could not be reached' },
  httpError: { status: 502, code: 'http_error', message: 'The publisher answered with an error' },
  tooLargeCode: 'too_large',
  timeoutCode: 'timeout',
  bodyTimeoutCode: 'timeout',
} satisfies Omit<RetrievalSubject, 'profile'>

export const FEED_ANSWERS = retrievalAnswers({ ...FEED_SUBJECT, profile: RETRIEVAL_PROFILES.feed })

export const PREVIEW_ANSWERS = retrievalAnswers({ ...FEED_SUBJECT, profile: RETRIEVAL_PROFILES.preview })

export const INVALID_FEED_ANSWERS: Readonly<Record<FeedDocumentFailureCode, FailureAnswer>> = {
  malformed_feed: { status: 422, code: 'invalid_feed', message: 'The Feed returned malformed XML' },
  unsupported_feed: {
    status: 422,
    code: 'invalid_feed',
    message: 'The URL did not return a supported RSS or Atom Feed',
  },
}

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
