import { Hono, type Context } from 'hono'
import {
  createSubscriptionRequestSchema,
  feedIdParameterSchema,
  importOpmlRequestSchema,
  updateFeedDetailsRequestSchema,
  updatePollingIntervalRequestSchema,
  type CreateSubscriptionResponse,
  type Digest,
  type FeedDetail,
  type FeedDetailsUpdate,
  type OpmlImportReport,
  type PollingSchedule,
  type RefreshFeedResponse,
  type SubscriptionList,
} from '../../shared/api.js'
import type { DigestService } from '../digest/digest-service.js'
import type { FeedRefresh, RefreshFeedOutcome } from '../subscriptions/feed-refresh.js'
import { MAX_OPML_FEEDS, type OpmlFailureCode } from '../subscriptions/opml.js'
import type { SubscribeOutcome, SubscriptionService } from '../subscriptions/subscription-service.js'
import { readIdParam } from './id-param.js'
import { readJsonBody } from './json-body.js'
import { readListCursor } from './list-cursor.js'
import { NO_STORE, notFound, retryAfter } from './responses.js'
import { answer, FEED_ANSWERS, INVALID_FEED_ANSWERS, PREVIEW_ANSWERS } from './retrieval-answers.js'

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

    const outcome = await deps.subscriptions.subscribe(body.value.url)
    if (outcome.kind === 'subscribed') {
      const { subscription, observedItems } = outcome
      return c.json<CreateSubscriptionResponse>({ subscription, observedItems }, 201, NO_STORE)
    }
    return subscribeFailure(c, outcome)
  })

  app.post('/subscriptions/import', async (c) => {
    const body = await readJsonBody(c, importOpmlRequestSchema)
    if (!body.ok) return body.response

    const outcome = deps.subscriptions.importOpml(body.value.opml)
    if (outcome.kind === 'invalid-opml') return opmlFailure(c, outcome.code)
    if (outcome.added > 0) deps.nudgeScheduler()
    return c.json<OpmlImportReport>(
      { added: outcome.added, alreadySubscribed: outcome.alreadySubscribed, unusable: [...outcome.unusable] },
      200,
      NO_STORE,
    )
  })

  app.get('/subscriptions/export', (c) =>
    c.body(deps.subscriptions.exportOpml(), 200, {
      ...NO_STORE,
      'Content-Type': 'text/x-opml; charset=utf-8',
      'Content-Disposition': 'attachment; filename="subscriptions.opml"',
    }),
  )

  app.get('/feeds', (c) => c.json<SubscriptionList>({ subscriptions: [...deps.subscriptions.list()] }, 200, NO_STORE))

  app.get('/feeds/:feedId', (c) => {
    const feedId = readIdParam(c, 'feedId', feedIdParameterSchema)
    if (!feedId.ok) return feedId.response

    const detail = deps.subscriptions.detail(feedId.value)
    if (!detail) return notFound(c)
    return c.json<FeedDetail>(detail, 200, NO_STORE)
  })

  app.post('/feeds/:feedId/refresh', async (c) => {
    const feedId = readIdParam(c, 'feedId', feedIdParameterSchema)
    if (!feedId.ok) return feedId.response

    const outcome = await deps.refresh.refresh(feedId.value)
    if (outcome.kind === 'updated') {
      return c.json<RefreshFeedResponse>({ observedItems: outcome.observedItems }, 200, NO_STORE)
    }
    if (outcome.kind === 'not-modified' || outcome.kind === 'merged') {
      return c.json<RefreshFeedResponse>({ observedItems: 0 }, 200, NO_STORE)
    }
    return refreshFailure(c, outcome)
  })

  app.delete('/feeds/:feedId', (c) => {
    const feedId = readIdParam(c, 'feedId', feedIdParameterSchema)
    if (!feedId.ok) return feedId.response

    const outcome = deps.subscriptions.unsubscribe(feedId.value)
    if (outcome.kind === 'missing') return notFound(c)
    return c.body(null, 204, NO_STORE)
  })

  app.put('/feeds/:feedId/details', async (c) => {
    const feedId = readIdParam(c, 'feedId', feedIdParameterSchema)
    if (!feedId.ok) return feedId.response

    const body = await readJsonBody(c, updateFeedDetailsRequestSchema)
    if (!body.ok) return body.response

    const outcome = deps.subscriptions.setFeedDetails(feedId.value, body.value)
    if (outcome.kind === 'missing') return notFound(c)
    return c.json<FeedDetailsUpdate>(outcome.details, 200, NO_STORE)
  })

  app.put('/feeds/:feedId/interval', async (c) => {
    const feedId = readIdParam(c, 'feedId', feedIdParameterSchema)
    if (!feedId.ok) return feedId.response

    const body = await readJsonBody(c, updatePollingIntervalRequestSchema)
    if (!body.ok) return body.response

    const outcome = deps.subscriptions.setPollingInterval(feedId.value, body.value.pollingIntervalMinutes)
    if (outcome.kind === 'missing') return notFound(c)
    return c.json<PollingSchedule>(outcome.schedule, 200, NO_STORE)
  })

  app.get('/digest', (c) => {
    const cursor = readListCursor(c)
    if (!cursor.ok) return cursor.response
    return c.json<Digest>(deps.digest.read(cursor.cursor), 200, NO_STORE)
  })

  return app
}

function subscribeFailure(c: Context, outcome: Exclude<SubscribeOutcome, { kind: 'subscribed' }>) {
  switch (outcome.kind) {
    case 'invalid-url':
      return c.json(
        { error: { code: 'invalid_feed_url', message: 'Enter an exact HTTP or HTTPS Feed URL' } },
        400,
        NO_STORE,
      )
    case 'duplicate':
      return c.json(
        {
          error: { code: 'duplicate_subscription', message: `Already subscribed to ${outcome.subscription.title}` },
          subscription: outcome.subscription,
        },
        409,
        NO_STORE,
      )
    case 'no-feed-found':
      return c.json({ error: { code: 'no_feed_found', message: 'No Feed was found at that address' } }, 422, NO_STORE)
    case 'invalid-feed':
      return answer(c, INVALID_FEED_ANSWERS[outcome.code])
    case 'retrieval-failed':
      return answer(c, PREVIEW_ANSWERS[outcome.failure.code])
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
      return c.json(
        { error: { code: 'refresh_rate_limited', message: 'Wait before refreshing this Feed again' } },
        429,
        retryAfter(outcome.retryAfterSeconds),
      )
    case 'invalid-feed':
      return answer(c, INVALID_FEED_ANSWERS[outcome.code])
    case 'retrieval-failed':
      return answer(c, FEED_ANSWERS[outcome.failure.code])
  }
}

function opmlFailure(c: Context, code: OpmlFailureCode) {
  switch (code) {
    case 'malformed_opml':
      return c.json({ error: { code, message: 'The OPML file is malformed XML' } }, 422, NO_STORE)
    case 'unsupported_opml':
      return c.json({ error: { code, message: 'The file is not an OPML subscription list' } }, 422, NO_STORE)
    case 'too_many_feeds':
      return c.json({ error: { code, message: `One import processes at most ${MAX_OPML_FEEDS} Feeds` } }, 413, NO_STORE)
  }
}
