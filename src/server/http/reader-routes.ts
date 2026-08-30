import { Hono } from 'hono'
import {
  feedItemIdParameterSchema,
  READER_CACHE_SECONDS,
  type ReaderArticle,
  type ReaderItem,
} from '../../shared/api.js'
import type { ReaderService } from '../reader/reader-service.js'
import { readIdParam } from './id-param.js'
import { NO_STORE, notFound, retryAfter } from './responses.js'
import { answer, ARTICLE_ANSWERS } from './retrieval-answers.js'

export interface ReaderRouteDependencies {
  readonly reader: Pick<ReaderService, 'item' | 'article'>
}

/**
 * Reader View over persisted Feed Items; no route here accepts an article URL
 * from the caller. Only a successful extraction may be cached — failures stay
 * uncached so a retry is a fresh question.
 */
export function readerRoutes(deps: ReaderRouteDependencies): Hono {
  const app = new Hono()

  app.get('/items/:feedItemId', (c) => {
    const feedItemId = readIdParam(c, 'feedItemId', feedItemIdParameterSchema)
    if (!feedItemId.ok) return feedItemId.response

    const item = deps.reader.item(feedItemId.value)
    if (!item) return notFound(c)
    return c.json<ReaderItem>(item, 200, NO_STORE)
  })

  app.get('/items/:feedItemId/reader', async (c) => {
    const feedItemId = readIdParam(c, 'feedItemId', feedItemIdParameterSchema)
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
        return c.json(
          { error: { code: 'no_original_link', message: 'The Feed Item has no original link to read' } },
          422,
          NO_STORE,
        )
      case 'unreadable':
        return c.json(
          { error: { code: 'article_unreadable', message: 'The original page did not yield a readable article' } },
          422,
          NO_STORE,
        )
      case 'deadline':
        return c.json(
          {
            error: {
              code: 'article_deadline_exceeded',
              message: 'The article is still being prepared',
              stage: outcome.stage,
            },
          },
          504,
          NO_STORE,
        )
      case 'rate-limited':
        return c.json(
          { error: { code: 'reader_retry_rate_limited', message: 'Wait before retrying this article' } },
          429,
          retryAfter(outcome.retryAfterSeconds),
        )
      case 'retrieval-failed':
        return answer(c, ARTICLE_ANSWERS[outcome.failure.code])
    }
  })

  return app
}
