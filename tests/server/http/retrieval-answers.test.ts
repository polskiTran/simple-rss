import { describe, expect, it } from 'vitest'
import { ARTICLE_ANSWERS, FEED_ANSWERS } from '../../../src/server/http/retrieval-answers.js'

describe('retrieval answers', () => {
  it('quotes each subject its own limits', () => {
    expect(FEED_ANSWERS.too_large.message).toBe('The Feed is larger than the 20 MiB limit')
    expect(FEED_ANSWERS.timeout.message).toBe('The Feed did not respond within 10 seconds')
    expect(FEED_ANSWERS.body_timeout.message).toBe('The Feed did not finish downloading within 60 seconds')
    expect(ARTICLE_ANSWERS.too_large.message).toBe('The original page is larger than the 5 MiB limit')
    expect(ARTICLE_ANSWERS.timeout.message).toBe('The original page did not respond within 10 seconds')
    expect(ARTICLE_ANSWERS.body_timeout.message).toBe('The original page did not finish downloading within 30 seconds')
  })
})
