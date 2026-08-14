import { Hono, type Context } from 'hono'
import {
  createSubscriptionRequestSchema,
  feedIdParameterSchema,
  importOpmlRequestSchema,
  MAX_FEED_SIZE_MIB,
  updatePollingIntervalRequestSchema,
  type CreateSubscriptionResponse,
  type Digest,
  type FeedDetail,
  type OpmlImportReport,
  type PollingSchedule,
  type RefreshFeedResponse,
  type SubscriptionList,
} from '../../shared/api.js'
import type { DigestService } from '../digest/digest-service.js'
import type { FeedDocumentFailureCode } from '../ingestion/feed-document.js'
import type { FeedRefresh, RefreshFeedOutcome } from '../subscriptions/feed-refresh.js'
import { MAX_OPML_FEEDS, type OpmlFailureCode } from '../subscriptions/opml.js'
import type { CreateSubscriptionOutcome, SubscriptionService } from '../subscriptions/subscription-service.js'
import { RETRIEVAL_PROFILES, type RetrievalFailureCode } from '../upstream/retrieval.js'
import { readJsonBody } from './json-body.js'
import { readListCursor } from './list-cursor.js'
import { NO_STORE, unavailable } from './responses.js'

export interface FeedRouteDependencies {
  readonly subscriptions: () => SubscriptionService | undefined
  readonly refresh: () => FeedRefresh | undefined
  readonly digest: () => DigestService | undefined
  /** Asks the scheduler to look at the due frontier now rather than next wake. */
  readonly nudgeScheduler: () => void
}

export function feedRoutes(deps: FeedRouteDependencies): Hono {
  const app = new Hono()

  app.post('/subscriptions', async (c) => {
    const service = deps.subscriptions()
    if (!service) return unavailable(c)

    const body = await readJsonBody(c, createSubscriptionRequestSchema)
    if (!body.ok) return body.response

    const outcome = service.create(body.value.url)
    if (outcome.kind === 'created') {
      deps.nudgeScheduler()
      return c.json<CreateSubscriptionResponse>({ subscription: outcome.subscription }, 201, NO_STORE)
    }
    return createFailure(c, outcome)
  })

  app.post('/subscriptions/import', async (c) => {
    const service = deps.subscriptions()
    if (!service) return unavailable(c)

    const body = await readJsonBody(c, importOpmlRequestSchema)
    if (!body.ok) return body.response

    const outcome = service.importOpml(body.value.opml)
    if (outcome.kind === 'invalid-opml') return opmlFailure(c, outcome.code)
    if (outcome.added > 0) deps.nudgeScheduler()
    return c.json<OpmlImportReport>(
      { added: outcome.added, alreadySubscribed: outcome.alreadySubscribed, unusable: [...outcome.unusable] },
      200,
      NO_STORE,
    )
  })

  app.get('/subscriptions/export', (c) => {
    const service = deps.subscriptions()
    if (!service) return unavailable(c)

    return c.body(service.exportOpml(), 200, {
      ...NO_STORE,
      'Content-Type': 'text/x-opml; charset=utf-8',
      'Content-Disposition': 'attachment; filename="subscriptions.opml"',
    })
  })

  app.get('/feeds', (c) => {
    const service = deps.subscriptions()
    if (!service) return unavailable(c)
    return c.json<SubscriptionList>({ subscriptions: [...service.list()] }, 200, NO_STORE)
  })

  app.get('/feeds/:feedId', (c) => {
    const service = deps.subscriptions()
    if (!service) return unavailable(c)
    const feedId = feedIdParameterSchema.safeParse(c.req.param('feedId'))
    if (!feedId.success) return c.json({ error: { code: 'not_found', message: 'Not found' } }, 404, NO_STORE)

    const detail = service.detail(feedId.data)
    if (!detail) return c.json({ error: { code: 'not_found', message: 'Not found' } }, 404, NO_STORE)
    return c.json<FeedDetail>(detail, 200, NO_STORE)
  })

  app.post('/feeds/:feedId/refresh', async (c) => {
    const refresh = deps.refresh()
    if (!refresh) return unavailable(c)
    const feedId = feedIdParameterSchema.safeParse(c.req.param('feedId'))
    if (!feedId.success) return c.json({ error: { code: 'not_found', message: 'Not found' } }, 404, NO_STORE)

    const outcome = await refresh.refresh(feedId.data)
    if (outcome.kind === 'updated') {
      return c.json<RefreshFeedResponse>({ observedItems: outcome.observedItems }, 200, NO_STORE)
    }
    if (outcome.kind === 'not-modified' || outcome.kind === 'merged') {
      return c.json<RefreshFeedResponse>({ observedItems: 0 }, 200, NO_STORE)
    }
    return refreshFailure(c, outcome)
  })

  app.delete('/feeds/:feedId', (c) => {
    const service = deps.subscriptions()
    if (!service) return unavailable(c)
    const feedId = feedIdParameterSchema.safeParse(c.req.param('feedId'))
    if (!feedId.success) return c.json({ error: { code: 'not_found', message: 'Not found' } }, 404, NO_STORE)

    const outcome = service.unsubscribe(feedId.data)
    if (outcome.kind === 'missing') {
      return c.json({ error: { code: 'not_found', message: 'Not found' } }, 404, NO_STORE)
    }
    return c.body(null, 204, NO_STORE)
  })

  app.put('/feeds/:feedId/interval', async (c) => {
    const service = deps.subscriptions()
    if (!service) return unavailable(c)
    const feedId = feedIdParameterSchema.safeParse(c.req.param('feedId'))
    if (!feedId.success) return c.json({ error: { code: 'not_found', message: 'Not found' } }, 404, NO_STORE)

    const body = await readJsonBody(c, updatePollingIntervalRequestSchema)
    if (!body.ok) return body.response

    const outcome = service.setPollingInterval(feedId.data, body.value.pollingIntervalMinutes)
    if (outcome.kind === 'missing') {
      return c.json({ error: { code: 'not_found', message: 'Not found' } }, 404, NO_STORE)
    }
    return c.json<PollingSchedule>(outcome.schedule, 200, NO_STORE)
  })

  app.get('/digest', (c) => {
    const digest = deps.digest()
    if (!digest) return unavailable(c)

    const cursor = readListCursor(c)
    if (!cursor.ok) return cursor.response
    return c.json<Digest>(digest.read(cursor.cursor), 200, NO_STORE)
  })

  return app
}

function createFailure(c: Context, outcome: Exclude<CreateSubscriptionOutcome, { kind: 'created' }>) {
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
  }
}

function refreshFailure(
  c: Context,
  outcome: Exclude<RefreshFeedOutcome, { kind: 'updated' } | { kind: 'not-modified' } | { kind: 'merged' }>,
) {
  switch (outcome.kind) {
    case 'missing':
      return c.json({ error: { code: 'not_found', message: 'Not found' } }, 404, NO_STORE)
    case 'rate-limited':
      return c.json(
        { error: { code: 'refresh_rate_limited', message: 'Wait before refreshing this Feed again' } },
        429,
        { ...NO_STORE, 'Retry-After': String(outcome.retryAfterSeconds) },
      )
    case 'invalid-feed':
      return invalidFeed(c, outcome.code)
    case 'retrieval-failed':
      return retrievalFailure(c, outcome.failure.code)
  }
}

function invalidFeed(c: Context, code: FeedDocumentFailureCode) {
  return c.json({ error: { code, message: feedDocumentMessage(code) } }, 422, NO_STORE)
}

function feedDocumentMessage(code: FeedDocumentFailureCode): string {
  return code === 'malformed_feed'
    ? 'The Feed returned malformed XML'
    : 'The URL did not return a supported RSS or Atom Feed'
}

interface FailureAnswer {
  readonly status: 400 | 413 | 415 | 502 | 504
  readonly code: string
  readonly message: string
}

const UNSAFE_URL: FailureAnswer = {
  status: 400,
  code: 'invalid_feed_url',
  message: 'The Feed URL is not a safe retrieval destination',
}
const UNSUPPORTED_CONTENT: FailureAnswer = {
  status: 415,
  code: 'unsupported_feed',
  message: 'The URL returned unsupported Feed content',
}
const UNREACHABLE: FailureAnswer = {
  status: 502,
  code: 'feed_unreachable',
  message: 'The Feed could not be reached',
}

const FEED_PROFILE = RETRIEVAL_PROFILES.feed

const RETRIEVAL_ANSWERS: Readonly<Record<RetrievalFailureCode, FailureAnswer>> = {
  invalid_request: UNSAFE_URL,
  invalid_url: UNSAFE_URL,
  blocked_destination: UNSAFE_URL,
  invalid_redirect: UNSAFE_URL,
  too_many_redirects: UNSAFE_URL,
  redirect_loop: UNSAFE_URL,
  unsupported_content_type: UNSUPPORTED_CONTENT,
  unsupported_content_encoding: UNSUPPORTED_CONTENT,
  too_large: {
    status: 413,
    code: 'feed_too_large',
    message: `The Feed is larger than the ${MAX_FEED_SIZE_MIB} MiB limit`,
  },
  timeout: {
    status: 504,
    code: 'feed_timeout',
    message: `The Feed did not respond within ${seconds(FEED_PROFILE.timeoutMs)} seconds`,
  },
  body_timeout: {
    status: 504,
    code: 'feed_body_timeout',
    message: `The Feed did not finish downloading within ${seconds(FEED_PROFILE.bodyTimeoutMs)} seconds`,
  },
  unresolvable_host: UNREACHABLE,
  http_error: UNREACHABLE,
  cancelled: UNREACHABLE,
  busy: UNREACHABLE,
  unavailable: UNREACHABLE,
}

function seconds(ms: number): number {
  return Math.round(ms / 1_000)
}

function retrievalFailure(c: Context, code: RetrievalFailureCode) {
  const answer = RETRIEVAL_ANSWERS[code]
  return c.json({ error: { code: answer.code, message: answer.message } }, answer.status, NO_STORE)
}

function opmlFailure(c: Context, code: OpmlFailureCode) {
  switch (code) {
    case 'malformed_opml':
      return c.json({ error: { code, message: 'The OPML file is malformed XML' } }, 422, NO_STORE)
    case 'unsupported_opml':
      return c.json({ error: { code, message: 'The file is not an OPML subscription list' } }, 422, NO_STORE)
    case 'too_many_feeds':
      return c.json(
        { error: { code, message: `One import processes at most ${MAX_OPML_FEEDS} Feeds` } },
        413,
        NO_STORE,
      )
  }
}
