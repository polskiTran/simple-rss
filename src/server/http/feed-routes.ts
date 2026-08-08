import { Hono, type Context } from 'hono'
import {
  createSubscriptionRequestSchema,
  feedIdParameterSchema,
  type CreateSubscriptionResponse,
  type Digest,
  type RefreshFeedResponse,
  type SubscriptionList,
} from '../../shared/api.js'
import type { DigestService } from '../digest/digest-service.js'
import type { FeedRefresh, RefreshFeedOutcome } from '../subscriptions/feed-refresh.js'
import type { CreateSubscriptionOutcome, SubscriptionService } from '../subscriptions/subscription-service.js'
import type { RetrievalFailureCode } from '../upstream/retrieval.js'
import { readJsonBody } from './json-body.js'
import { NO_STORE, unavailable } from './responses.js'

export interface FeedRouteDependencies {
  readonly subscriptions: () => SubscriptionService | undefined
  readonly refresh: () => FeedRefresh | undefined
  readonly digest: () => DigestService | undefined
}

/** Subscription creation, the Feed list, and the chronological Digest. */
export function feedRoutes(deps: FeedRouteDependencies): Hono {
  const app = new Hono()

  app.post('/subscriptions', async (c) => {
    const service = deps.subscriptions()
    if (!service) return unavailable(c)

    const body = await readJsonBody(c, createSubscriptionRequestSchema)
    if (!body.ok) return body.response

    const outcome = await service.create(body.value.url)
    if (outcome.kind === 'created') {
      return c.json<CreateSubscriptionResponse>(
        { subscription: outcome.subscription, importedItems: outcome.importedItems },
        201,
        NO_STORE,
      )
    }
    return createFailure(c, outcome)
  })

  app.get('/feeds', (c) => {
    const service = deps.subscriptions()
    if (!service) return unavailable(c)
    return c.json<SubscriptionList>({ subscriptions: [...service.list()] }, 200, NO_STORE)
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
    return refreshFailure(c, outcome)
  })

  app.get('/digest', (c) => {
    const digest = deps.digest()
    if (!digest) return unavailable(c)
    return c.json<Digest>(digest.read(), 200, NO_STORE)
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
    case 'invalid-feed':
      return c.json(
        {
          error: {
            code: outcome.code,
            message:
              outcome.code === 'malformed_feed'
                ? 'The Feed returned malformed XML'
                : 'The URL did not return a supported RSS or Atom Feed',
          },
        },
        422,
        NO_STORE,
      )
    case 'retrieval-failed':
      return retrievalFailure(c, outcome.failure.code)
  }
}

function refreshFailure(c: Context, outcome: Exclude<RefreshFeedOutcome, { kind: 'updated' }>) {
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
      return c.json(
        {
          error: {
            code: outcome.code,
            message:
              outcome.code === 'malformed_feed'
                ? 'The Feed returned malformed XML'
                : 'The URL did not return a supported RSS or Atom Feed',
          },
        },
        422,
        NO_STORE,
      )
    case 'retrieval-failed':
      return retrievalFailure(c, outcome.failure.code)
  }
}


function retrievalFailure(c: Context, code: RetrievalFailureCode) {
  switch (code) {
    case 'invalid_request':
    case 'invalid_url':
    case 'blocked_destination':
    case 'unresolvable_host':
    case 'invalid_redirect':
    case 'too_many_redirects':
    case 'redirect_loop':
      return c.json(
        { error: { code: 'invalid_feed_url', message: 'The Feed URL could not be reached safely' } },
        400,
        NO_STORE,
      )
    case 'unsupported_content_type':
    case 'unsupported_content_encoding':
      return c.json(
        { error: { code: 'unsupported_feed', message: 'The URL returned unsupported Feed content' } },
        415,
        NO_STORE,
      )
    case 'too_large':
      return c.json(
        { error: { code: 'feed_too_large', message: 'The Feed is larger than the 2 MiB limit' } },
        413,
        NO_STORE,
      )
    case 'timeout':
      return c.json(
        { error: { code: 'feed_timeout', message: 'The Feed did not respond within 10 seconds' } },
        504,
        NO_STORE,
      )
    case 'http_error':
    case 'cancelled':
    case 'busy':
    case 'unavailable':
      return c.json(
        { error: { code: 'feed_unreachable', message: 'The Feed could not be reached' } },
        502,
        NO_STORE,
      )
  }
}
