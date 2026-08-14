import { describe, expect, it } from 'vitest'
import { ARTICLE_ANSWERS, FEED_ANSWERS } from '../../../src/server/http/retrieval-answers.js'
import type { RetrievalFailureCode } from '../../../src/server/upstream/retrieval.js'

/** Every code, with the answer each subject gave before the two tables became one. */
const ANSWERS: ReadonlyArray<readonly [RetrievalFailureCode, number, string, string]> = [
  ['invalid_request', 400, 'invalid_feed_url', 'article_link_unsafe'],
  ['invalid_url', 400, 'invalid_feed_url', 'article_link_unsafe'],
  ['blocked_destination', 400, 'invalid_feed_url', 'article_link_unsafe'],
  ['invalid_redirect', 400, 'invalid_feed_url', 'article_link_unsafe'],
  ['too_many_redirects', 400, 'invalid_feed_url', 'article_link_unsafe'],
  ['redirect_loop', 400, 'invalid_feed_url', 'article_link_unsafe'],
  ['unsupported_content_type', 415, 'unsupported_feed', 'unsupported_article'],
  ['unsupported_content_encoding', 415, 'unsupported_feed', 'unsupported_article'],
  ['too_large', 413, 'feed_too_large', 'article_too_large'],
  ['timeout', 504, 'feed_timeout', 'article_timeout'],
  ['body_timeout', 504, 'feed_body_timeout', 'article_body_timeout'],
  ['unresolvable_host', 502, 'feed_unreachable', 'article_unreachable'],
  ['http_error', 502, 'feed_unreachable', 'article_unreachable'],
  ['cancelled', 502, 'feed_unreachable', 'article_unreachable'],
  ['busy', 502, 'feed_unreachable', 'article_unreachable'],
  ['unavailable', 502, 'feed_unreachable', 'article_unreachable'],
]

describe('retrieval answers', () => {
  it.each(ANSWERS)('answers %s as %i, %s for a Feed and %s for an article', (code, status, feedCode, articleCode) => {
    expect(FEED_ANSWERS[code]).toMatchObject({ status, code: feedCode })
    expect(ARTICLE_ANSWERS[code]).toMatchObject({ status, code: articleCode })
  })

  // The two subjects share a shape, so a code added to one is added to both.
  it('covers every failure code and no more', () => {
    const covered = ANSWERS.map(([code]) => code)
    expect(Object.keys(FEED_ANSWERS).sort()).toEqual([...covered].sort())
    expect(Object.keys(ARTICLE_ANSWERS).sort()).toEqual([...covered].sort())
  })

  // The size and timing messages are read off the operation profile rather than
  // written out, so they must still quote the ceilings the boundary enforces.
  it('quotes each subject its own limits', () => {
    expect(FEED_ANSWERS.too_large.message).toBe('The Feed is larger than the 20 MiB limit')
    expect(FEED_ANSWERS.timeout.message).toBe('The Feed did not respond within 10 seconds')
    expect(FEED_ANSWERS.body_timeout.message).toBe('The Feed did not finish downloading within 60 seconds')
    expect(ARTICLE_ANSWERS.too_large.message).toBe('The original page is larger than the 5 MiB limit')
    expect(ARTICLE_ANSWERS.timeout.message).toBe('The original page did not respond within 10 seconds')
    expect(ARTICLE_ANSWERS.body_timeout.message).toBe('The original page did not finish downloading within 30 seconds')
  })
})
