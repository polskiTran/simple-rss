import { Hono, type Context } from 'hono'
import {
  feedItemIdParameterSchema,
  READER_CACHE_SECONDS,
  type ReaderArticle,
  type ReaderItem,
} from '../../shared/api.js'
import type { ReaderService } from '../reader/reader-service.js'
import type { RetrievalFailureCode } from '../upstream/retrieval.js'
import { NO_STORE, unavailable } from './responses.js'

export interface ReaderRouteDependencies {
  /** Absent only while startup could not open the database. */
  readonly reader: () => Pick<ReaderService, 'item' | 'article'> | undefined
}

/**
 * Reader View over persisted Feed Items; no route here accepts an article URL
 * from the caller. Only a successful extraction may be cached — failures stay
 * uncached so a retry is a fresh question.
 */
export function readerRoutes(deps: ReaderRouteDependencies): Hono {
  const app = new Hono()

  app.get('/items/:feedItemId', (c) => {
    const reader = deps.reader()
    if (!reader) return unavailable(c)
    const feedItemId = feedItemIdParameterSchema.safeParse(c.req.param('feedItemId'))
    if (!feedItemId.success) return notFound(c)

    const item = reader.item(feedItemId.data)
    if (!item) return notFound(c)
    return c.json<ReaderItem>(item, 200, NO_STORE)
  })

  app.get('/items/:feedItemId/reader', async (c) => {
    const reader = deps.reader()
    if (!reader) return unavailable(c)
    const feedItemId = feedItemIdParameterSchema.safeParse(c.req.param('feedItemId'))
    if (!feedItemId.success) return notFound(c)

    const outcome = await reader.article(feedItemId.data)
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
      case 'rate-limited':
        return c.json(
          { error: { code: 'reader_retry_rate_limited', message: 'Wait before retrying this article' } },
          429,
          { ...NO_STORE, 'Retry-After': String(outcome.retryAfterSeconds) },
        )
      case 'retrieval-failed': {
        const answer = ARTICLE_ANSWERS[outcome.failure.code]
        return c.json({ error: { code: answer.code, message: answer.message } }, answer.status, NO_STORE)
      }
    }
  })

  return app
}

interface FailureAnswer {
  readonly status: 400 | 413 | 415 | 502 | 504
  readonly code: string
  readonly message: string
}

const UNSAFE_LINK: FailureAnswer = {
  status: 400,
  code: 'article_link_unsafe',
  message: 'The original link is not a safe retrieval destination',
}
const UNREACHABLE: FailureAnswer = {
  status: 502,
  code: 'article_unreachable',
  message: 'The original page could not be reached',
}
const UNSUPPORTED: FailureAnswer = {
  status: 415,
  code: 'unsupported_article',
  message: 'The original page is not readable HTML',
}

/** One answer per retrieval failure category, mirroring the Feed routes. */
const ARTICLE_ANSWERS: Readonly<Record<RetrievalFailureCode, FailureAnswer>> = {
  invalid_request: UNSAFE_LINK,
  invalid_url: UNSAFE_LINK,
  blocked_destination: UNSAFE_LINK,
  invalid_redirect: UNSAFE_LINK,
  too_many_redirects: UNSAFE_LINK,
  redirect_loop: UNSAFE_LINK,
  unsupported_content_type: UNSUPPORTED,
  unsupported_content_encoding: UNSUPPORTED,
  too_large: { status: 413, code: 'article_too_large', message: 'The original page is larger than the 5 MiB limit' },
  timeout: { status: 504, code: 'article_timeout', message: 'The original page did not respond within 10 seconds' },
  body_timeout: {
    status: 504,
    code: 'article_body_timeout',
    message: 'The original page did not finish downloading within 30 seconds',
  },
  unresolvable_host: UNREACHABLE,
  http_error: UNREACHABLE,
  cancelled: UNREACHABLE,
  busy: UNREACHABLE,
  unavailable: UNREACHABLE,
}

function notFound(c: Context) {
  return c.json({ error: { code: 'not_found', message: 'Not found' } }, 404, NO_STORE)
}
