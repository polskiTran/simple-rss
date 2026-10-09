import { describe, expect, it } from 'vitest'
import { readerRoutes } from '../../../src/server/http/reader-routes.js'
import type { ReaderArticleOutcome } from '../../../src/server/reader/reader-service.js'

function appAnswering(outcome: ReaderArticleOutcome) {
  return readerRoutes({
    readerItems: { item: () => undefined },
    reader: { article: async () => outcome },
  })
}

describe('Reader failure answers', () => {
  // The per-code answers are the article table's; this proves the route reads it.
  it('answers a Retrieval failure from the article answers, uncached', async () => {
    const outcome: ReaderArticleOutcome = {
      kind: 'retrieval-failed',
      failure: { ok: false, code: 'blocked_destination', reason: 'scripted' },
    }
    const response = await appAnswering(outcome).request('/items/7/reader')

    expect(response.status).toBe(400)
    expect(response.headers.get('cache-control')).toBe('no-store')
    const body = (await response.json()) as { error: { code: string } }
    expect(body.error.code).toBe('article_link_unsafe')
  })

  it('answers the deadline as 504 article_deadline_exceeded with its stage, uncached', async () => {
    const response = await appAnswering({ kind: 'deadline', stage: 'publisher' }).request('/items/7/reader')

    expect(response.status).toBe(504)
    expect(response.headers.get('cache-control')).toBe('no-store')
    const body = (await response.json()) as { error: { code: string; stage: string } }
    expect(body.error.code).toBe('article_deadline_exceeded')
    expect(body.error.stage).toBe('publisher')
  })

  it('never caches the rate-limited answer and names the wait', async () => {
    const response = await appAnswering({ kind: 'rate-limited', retryAfterSeconds: 17 }).request('/items/7/reader')

    expect(response.status).toBe(429)
    expect(response.headers.get('retry-after')).toBe('17')
    expect(response.headers.get('cache-control')).toBe('no-store')
  })
})
