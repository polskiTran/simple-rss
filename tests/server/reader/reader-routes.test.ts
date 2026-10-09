import { describe, expect, it } from 'vitest'
import { apiErrorSchema } from '../../../src/shared/api.js'
import { readerRoutes } from '../../../src/server/http/reader-routes.js'
import type { ReaderArticleOutcome } from '../../../src/server/reader/reader-service.js'

function appAnswering(outcome: ReaderArticleOutcome) {
  return readerRoutes({
    readerItems: { item: () => undefined },
    reader: { article: async () => outcome },
  })
}

describe('Reader failure answers', () => {
  // The per-code answers are the Original webpage table's; this proves the route reads it.
  // No-store is the app's default for every /api answer, pinned in api.test.ts.
  it('answers a Retrieval failure from the Original webpage answers', async () => {
    const outcome: ReaderArticleOutcome = {
      kind: 'retrieval-failed',
      failure: { ok: false, code: 'blocked_destination', reason: 'scripted' },
    }
    const response = await appAnswering(outcome).request('/items/7/reader')

    expect(response.status).toBe(400)
    expect(apiErrorSchema.parse(await response.json()).error.code).toBe('article_link_unsafe')
  })

  it('answers the deadline as 504 article_deadline_exceeded with its stage', async () => {
    const response = await appAnswering({ kind: 'deadline', stage: 'publisher' }).request('/items/7/reader')

    expect(response.status).toBe(504)
    const { error } = apiErrorSchema.parse(await response.json())
    expect(error.code).toBe('article_deadline_exceeded')
    expect(error.stage).toBe('publisher')
  })

  it('names the wait on the rate-limited answer', async () => {
    const response = await appAnswering({ kind: 'rate-limited', retryAfterSeconds: 17 }).request('/items/7/reader')

    expect(response.status).toBe(429)
    expect(response.headers.get('retry-after')).toBe('17')
  })
})
