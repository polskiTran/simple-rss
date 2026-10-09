import { Hono, type Context } from 'hono'
import {
  createSubscriptionRequestSchema,
  digestRequestSchema,
  importOpmlRequestSchema,
  readingSourcePreferenceSchema,
  updateFeedDetailsRequestSchema,
  updatePollingIntervalRequestSchema,
  type ApiErrorBody,
  type CreateSubscriptionResponse,
  type Digest,
  type DigestCalendar,
  type FeedDetail,
  type FeedDetailsUpdate,
  type OpmlImportReport,
  type PollingSchedule,
  type ReadingSourcePreference,
  type RefreshFeedResponse,
  type SubscriptionList,
} from '../../shared/api.js'
import type { DigestService } from '../digest/digest-service.js'
import type { FeedDocumentFailureCode } from '../ingestion/feed-document.js'
import type { FeedRefresh, RefreshFeedOutcome } from '../subscriptions/feed-refresh.js'
import { MAX_OPML_FEEDS, type OpmlFailureCode } from '../subscriptions/opml.js'
import type { CreateSubscriptionOutcome, SubscriptionService } from '../subscriptions/subscription-service.js'
import { apiError, notFound, readId, readJsonBody } from './requests.js'
import { answer, FEED_ANSWERS } from './retrieval-answers.js'

export interface FeedRouteDependencies {
  readonly subscriptions: SubscriptionService
  readonly refresh: FeedRefresh
  readonly digest: DigestService
  /** Asks the scheduler to look at the due frontier now rather than next wake. */
  readonly nudgeScheduler: () => void
}

export function feedRoutes(deps: FeedRouteDependencies): Hono {
  const app = new Hono()

  app.post('/subscriptions', async (c) => {
    const body = await readJsonBody(c, createSubscriptionRequestSchema)
    if (!body.ok) return body.response

    const outcome = deps.subscriptions.create(body.value.url)
    if (outcome.kind === 'created') {
      deps.nudgeScheduler()
      return c.json<CreateSubscriptionResponse>({ subscription: outcome.subscription }, 201)
    }
    return createFailure(c, outcome)
  })

  app.post('/subscriptions/import', async (c) => {
    const body = await readJsonBody(c, importOpmlRequestSchema)
    if (!body.ok) return body.response

    const outcome = deps.subscriptions.importOpml(body.value.opml)
    if (outcome.kind === 'invalid-opml') return opmlFailure(c, outcome.code)
    if (outcome.added > 0) deps.nudgeScheduler()
    return c.json<OpmlImportReport>({
      added: outcome.added,
      alreadySubscribed: outcome.alreadySubscribed,
      unusable: [...outcome.unusable],
    })
  })

  app.get('/subscriptions/export', (c) =>
    c.body(deps.subscriptions.exportOpml(), 200, {
      'Content-Type': 'text/x-opml; charset=utf-8',
      'Content-Disposition': 'attachment; filename="subscriptions.opml"',
    }),
  )

  app.get('/feeds', (c) => c.json<SubscriptionList>({ subscriptions: [...deps.subscriptions.list()] }))

  app.get('/feeds/:feedId', (c) => {
    const feedId = readId(c, 'feedId')
    if (!feedId.ok) return feedId.response

    const detail = deps.subscriptions.detail(feedId.value)
    if (!detail) return notFound(c)
    return c.json<FeedDetail>(detail)
  })

  app.post('/feeds/:feedId/refresh', async (c) => {
    const feedId = readId(c, 'feedId')
    if (!feedId.ok) return feedId.response

    const outcome = await deps.refresh.refresh(feedId.value)
    if (outcome.kind === 'updated') {
      return c.json<RefreshFeedResponse>({ observedItems: outcome.observedItems })
    }
    if (outcome.kind === 'not-modified' || outcome.kind === 'merged') {
      return c.json<RefreshFeedResponse>({ observedItems: 0 })
    }
    return refreshFailure(c, outcome)
  })

  app.delete('/feeds/:feedId', (c) => {
    const feedId = readId(c, 'feedId')
    if (!feedId.ok) return feedId.response

    if (!deps.subscriptions.unsubscribe(feedId.value)) return notFound(c)
    return c.body(null, 204)
  })

  app.put('/feeds/:feedId/details', async (c) => {
    const feedId = readId(c, 'feedId')
    if (!feedId.ok) return feedId.response

    const body = await readJsonBody(c, updateFeedDetailsRequestSchema)
    if (!body.ok) return body.response

    const details = deps.subscriptions.setFeedDetails(feedId.value, body.value)
    if (!details) return notFound(c)
    return c.json<FeedDetailsUpdate>(details)
  })

  app.put('/feeds/:feedId/interval', async (c) => {
    const feedId = readId(c, 'feedId')
    if (!feedId.ok) return feedId.response

    const body = await readJsonBody(c, updatePollingIntervalRequestSchema)
    if (!body.ok) return body.response

    const schedule = deps.subscriptions.setPollingInterval(feedId.value, body.value.pollingIntervalMinutes)
    if (!schedule) return notFound(c)
    return c.json<PollingSchedule>(schedule)
  })

  app.put('/feeds/:feedId/reading-source', async (c) => {
    const feedId = readId(c, 'feedId')
    if (!feedId.ok) return feedId.response

    const body = await readJsonBody(c, readingSourcePreferenceSchema)
    if (!body.ok) return body.response

    const { readingSource } = body.value
    if (!deps.subscriptions.setReadingSource(feedId.value, readingSource)) return notFound(c)
    return c.json<ReadingSourcePreference>({ readingSource })
  })

  app.get('/digest', (c) => {
    const filter = digestRequestSchema.safeParse({ from: c.req.query('from') })
    if (!filter.success) return apiError(c, 400, 'invalid_request', 'The Digest starts from a day as YYYY-MM-DD')
    return c.json<Digest>(deps.digest.read(filter.data))
  })

  app.get('/digest/days', (c) => c.json<DigestCalendar>(deps.digest.calendar()))

  return app
}

function createFailure(c: Context, outcome: Exclude<CreateSubscriptionOutcome, { kind: 'created' }>) {
  switch (outcome.kind) {
    case 'invalid-url':
      return apiError(c, 400, 'invalid_feed_url', 'Enter an exact HTTP or HTTPS Feed URL')
    case 'duplicate':
      return c.json<ApiErrorBody & CreateSubscriptionResponse>(
        {
          error: { code: 'duplicate_subscription', message: `Already subscribed to ${outcome.subscription.title}` },
          subscription: outcome.subscription,
        },
        409,
      )
  }
}

function refreshFailure(
  c: Context,
  outcome: Exclude<RefreshFeedOutcome, { kind: 'updated' } | { kind: 'not-modified' } | { kind: 'merged' }>,
) {
  switch (outcome.kind) {
    case 'missing':
      return notFound(c)
    case 'rate-limited':
      return apiError(c, 429, 'refresh_rate_limited', 'Wait before refreshing this Feed again', {
        'Retry-After': String(outcome.retryAfterSeconds),
      })
    case 'invalid-feed':
      return invalidFeed(c, outcome.code)
    case 'retrieval-failed':
      return answer(c, FEED_ANSWERS[outcome.failure.code])
  }
}

function invalidFeed(c: Context, code: FeedDocumentFailureCode) {
  const message =
    code === 'malformed_feed'
      ? 'The Feed returned malformed XML'
      : 'The URL did not return a supported RSS or Atom Feed'
  return apiError(c, 422, code, message)
}

function opmlFailure(c: Context, code: OpmlFailureCode) {
  switch (code) {
    case 'malformed_opml':
      return apiError(c, 422, code, 'The OPML file is malformed XML')
    case 'unsupported_opml':
      return apiError(c, 422, code, 'The file is not an OPML subscription list')
    case 'too_many_feeds':
      return apiError(c, 413, code, `One import processes at most ${MAX_OPML_FEEDS} Feeds`)
  }
}
