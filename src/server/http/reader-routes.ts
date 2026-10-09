import { Hono } from 'hono'
import { READER_CACHE_SECONDS, type ApiErrorBody, type ReaderArticle, type ReaderItem } from '../../shared/api.js'
import type { ReaderItems } from '../reader/reader-items.js'
import type { ReaderService } from '../reader/reader-service.js'
import { apiError, notFound, readId } from './requests.js'
import { answer, ORIGINAL_WEBPAGE_ANSWERS } from './retrieval-answers.js'

export interface ReaderRouteDependencies {
  readonly readerItems: Pick<ReaderItems, 'item'>
  readonly reader: Pick<ReaderService, 'article'>
}

/**
 * Reader View over persisted Feed Item identity; no route accepts an article URL.
 * The item response carries the Subscription preference and stored Feed Content,
 * while `/reader` is only Original webpage extraction. Item responses stay
 * uncached for fresh image signatures; only successful extraction may be cached.
 */
export function readerRoutes(deps: ReaderRouteDependencies): Hono {
  const app = new Hono()

  app.get('/items/:feedItemId', (c) => {
    const feedItemId = readId(c, 'feedItemId')
    if (!feedItemId.ok) return feedItemId.response

    const item = deps.readerItems.item(feedItemId.value)
    if (!item) return notFound(c)
    return c.json<ReaderItem>(item)
  })

  app.get('/items/:feedItemId/reader', async (c) => {
    const feedItemId = readId(c, 'feedItemId')
    if (!feedItemId.ok) return feedItemId.response

    const outcome = await deps.reader.article(feedItemId.value, c.req.raw.signal)
    switch (outcome.kind) {
      case 'extracted':
        return c.json<ReaderArticle>(outcome.article, 200, {
          'Cache-Control': `private, max-age=${READER_CACHE_SECONDS}`,
        })
      case 'missing':
        return notFound(c)
      case 'no-link':
        return apiError(c, 422, 'no_original_link', 'The Feed Item has no original link to read')
      case 'unreadable':
        return apiError(c, 422, 'article_unreadable', 'The original page did not yield a readable article')
      case 'deadline':
        return c.json<ApiErrorBody>(
          {
            error: {
              code: 'article_deadline_exceeded',
              message: 'The article is still being prepared',
              stage: outcome.stage,
            },
          },
          504,
        )
      case 'rate-limited':
        return apiError(c, 429, 'reader_retry_rate_limited', 'Wait before retrying this article', {
          'Retry-After': String(outcome.retryAfterSeconds),
        })
      case 'retrieval-failed':
        return answer(c, ORIGINAL_WEBPAGE_ANSWERS[outcome.failure.code])
    }
  })

  return app
}
