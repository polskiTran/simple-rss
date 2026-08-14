import { describe, expect, it } from 'vitest'
import { readerRoutes } from '../../../src/server/http/reader-routes.js'
import type { ReaderArticleOutcome } from '../../../src/server/reader/reader-service.js'
import type { RetrievalFailureCode } from '../../../src/server/upstream/retrieval.js'

function appAnswering(outcome: ReaderArticleOutcome) {
  return readerRoutes({
    reader: () => ({
      item: () => undefined,
      article: async () => outcome,
    }),
  })
}

function failed(code: RetrievalFailureCode): ReaderArticleOutcome {
  return { kind: 'retrieval-failed', failure: { ok: false, code, reason: 'scripted' } }
}

describe('Reader failure answers', () => {
  it.each([
    ['timeout', 504, 'article_timeout'],
    ['too_large', 413, 'article_too_large'],
    ['unsupported_content_type', 415, 'unsupported_article'],
    ['unsupported_content_encoding', 415, 'unsupported_article'],
    ['blocked_destination', 400, 'article_link_unsafe'],
    ['too_many_redirects', 400, 'article_link_unsafe'],
    ['redirect_loop', 400, 'article_link_unsafe'],
    ['invalid_url', 400, 'article_link_unsafe'],
    ['unresolvable_host', 502, 'article_unreachable'],
    ['http_error', 502, 'article_unreachable'],
    ['busy', 502, 'article_unreachable'],
  ] as const)('answers %s as %i %s, uncached', async (code, status, answerCode) => {
    const response = await appAnswering(failed(code)).request('/items/7/reader')

    expect(response.status).toBe(status)
    expect(response.headers.get('cache-control')).toBe('no-store')
    const body = (await response.json()) as { error: { code: string } }
    expect(body.error.code).toBe(answerCode)
  })

  it('never caches the rate-limited answer and names the wait', async () => {
    const response = await appAnswering({ kind: 'rate-limited', retryAfterSeconds: 17 }).request(
      '/items/7/reader',
    )

    expect(response.status).toBe(429)
    expect(response.headers.get('retry-after')).toBe('17')
    expect(response.headers.get('cache-control')).toBe('no-store')
  })
})
