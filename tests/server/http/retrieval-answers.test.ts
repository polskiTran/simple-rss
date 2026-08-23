import { describe, expect, it } from 'vitest'
import { feedAvailabilityCategorySchema } from '../../../src/shared/api.js'
import { ARTICLE_ANSWERS, FEED_ANSWERS, PREVIEW_ANSWERS } from '../../../src/server/http/retrieval-answers.js'
import { availabilityCategoryOf } from '../../../src/server/subscriptions/feed-availability.js'
import type { RetrievalFailureCode } from '../../../src/server/upstream/retrieval.js'

const ANSWERS: ReadonlyArray<readonly [RetrievalFailureCode, number, string, string]> = [
  ['invalid_request', 400, 'invalid_feed_url', 'article_link_unsafe'],
  ['invalid_url', 400, 'invalid_feed_url', 'article_link_unsafe'],
  ['blocked_destination', 400, 'invalid_feed_url', 'article_link_unsafe'],
  ['invalid_redirect', 400, 'invalid_feed_url', 'article_link_unsafe'],
  ['too_many_redirects', 400, 'invalid_feed_url', 'article_link_unsafe'],
  ['redirect_loop', 400, 'invalid_feed_url', 'article_link_unsafe'],
  ['unsupported_content_type', 415, 'unsupported_content', 'unsupported_article'],
  ['unsupported_content_encoding', 415, 'unsupported_content', 'unsupported_article'],
  ['too_large', 413, 'too_large', 'article_too_large'],
  ['timeout', 504, 'timeout', 'article_timeout'],
  ['body_timeout', 504, 'timeout', 'article_body_timeout'],
  ['unresolvable_host', 502, 'unreachable', 'article_unreachable'],
  ['http_error', 502, 'http_error', 'article_unreachable'],
  ['cancelled', 502, 'unreachable', 'article_unreachable'],
  ['busy', 502, 'unreachable', 'article_unreachable'],
  ['unavailable', 502, 'unreachable', 'article_unreachable'],
]

describe('retrieval answers', () => {
  it.each(ANSWERS)('answers %s as %i, %s for a Feed and %s for an article', (code, status, feedCode, articleCode) => {
    expect(FEED_ANSWERS[code]).toMatchObject({ status, code: feedCode })
    expect(PREVIEW_ANSWERS[code]).toMatchObject({ status, code: feedCode })
    expect(ARTICLE_ANSWERS[code]).toMatchObject({ status, code: articleCode })
  })

  // The two subjects share a shape, so a code added to one is added to both.
  it('covers every failure code and no more', () => {
    const covered = ANSWERS.map(([code]) => code)
    expect(Object.keys(FEED_ANSWERS).sort()).toEqual([...covered].sort())
    expect(Object.keys(ARTICLE_ANSWERS).sort()).toEqual([...covered].sort())
  })

  it('names the category the same failure would record', () => {
    for (const [code, , feedCode] of ANSWERS) {
      if (feedCode === 'invalid_feed_url') continue
      const answered = FEED_ANSWERS[code].code
      expect(answered, code).toBe(
        availabilityCategoryOf({ kind: 'retrieval-failed', failure: { ok: false, code, reason: '' } }),
      )
      expect(feedAvailabilityCategorySchema.options).toContain(answered)
    }
  })

  // The size and timing messages are read off the operation profile rather than
  // written out, so they must still quote the ceilings the boundary enforces.
  it('quotes each subject its own limits', () => {
    expect(FEED_ANSWERS.too_large.message).toBe('The Feed is larger than the 20 MiB limit')
    expect(FEED_ANSWERS.timeout.message).toBe('The Feed did not respond within 10 seconds')
    expect(FEED_ANSWERS.body_timeout.message).toBe('The Feed did not finish downloading within 60 seconds')
    expect(PREVIEW_ANSWERS.timeout.message).toBe('The Feed did not respond within 15 seconds')
    expect(ARTICLE_ANSWERS.too_large.message).toBe('The original page is larger than the 5 MiB limit')
    expect(ARTICLE_ANSWERS.timeout.message).toBe('The original page did not respond within 10 seconds')
    expect(ARTICLE_ANSWERS.body_timeout.message).toBe('The original page did not finish downloading within 30 seconds')
  })
})
