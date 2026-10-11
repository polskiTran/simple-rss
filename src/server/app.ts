import { Hono, type MiddlewareHandler } from 'hono'
import type { Liveness, Readiness as ReadinessBody, ServiceMeta } from '../shared/api.js'
import { VERSION } from './version.js'
import type { Authentication } from './auth/authentication.js'
import type { Clock } from './clock.js'
import type { Config } from './config.js'
import type { DigestService } from './digest/digest-service.js'
import type { ImageService } from './images/image-service.js'
import type { ImageUrlSignature } from './images/image-url-signature.js'
import type { LibraryService } from './library/library-service.js'
import type { Logger } from './logger.js'
import { elapsedMs } from './monotonic.js'
import { assertWritable, type DrizzleDatabase } from './persistence/database.js'
import type { InstallationSettingsStore } from './persistence/installation-settings.js'
import type { ReaderItems } from './reader/reader-items.js'
import type { ReaderService } from './reader/reader-service.js'
import type { SearchService } from './search/search-service.js'
import type { FeedPoll } from './subscriptions/feed-poll.js'
import type { FeedPreview } from './subscriptions/feed-preview.js'
import type { FeedRefresh } from './subscriptions/feed-refresh.js'
import type { PollScheduler } from './subscriptions/poll-scheduler.js'
import type { SubscriptionService } from './subscriptions/subscription-service.js'
import { authRoutes } from './http/auth-routes.js'
import { exportRoutes } from './http/export-routes.js'
import { feedRoutes } from './http/feed-routes.js'
import { imageRoutes } from './http/image-routes.js'
import { libraryRoutes } from './http/library-routes.js'
import { readerRoutes } from './http/reader-routes.js'
import { searchRoutes } from './http/search-routes.js'
import { settingsRoutes } from './http/settings-routes.js'
import { apiError } from './http/requests.js'
import { requireSession } from './http/require-session.js'
import { sameOrigin } from './http/same-origin.js'
import { securityHeaders } from './http/security-headers.js'
import { staticAssets } from './http/static-assets.js'

/**
 * Everything a serving installation has. Declared here, where it is consumed,
 * so the composition root depends on this contract rather than the reverse.
 * The bundle is built whole or not at all, so no route downstream has to ask
 * whether one piece of it arrived.
 */
export interface Services {
  /** The process-wide Drizzle handle shared by routes and operational checks. */
  readonly db: DrizzleDatabase
  readonly authentication: Authentication
  readonly settings: InstallationSettingsStore
  readonly subscriptions: SubscriptionService
  readonly poll: FeedPoll
  readonly preview: FeedPreview
  readonly refresh: FeedRefresh
  readonly digest: DigestService
  readonly library: LibraryService
  readonly readerItems: ReaderItems
  readonly reader: ReaderService
  readonly search: SearchService
  readonly images: ImageService
  readonly imageSignature: ImageUrlSignature
  /** The in-process background poller; routes only ever nudge it. */
  readonly scheduler: PollScheduler
}

/** What startup produced: the whole bundle, or the reason there is none. */
export type Startup =
  | { readonly kind: 'ready'; readonly services: Services }
  | { readonly kind: 'failed'; readonly reason: string }

export interface AppDependencies {
  readonly config: Config
  readonly clock: Clock
  readonly logger: Logger
  /** A failed startup keeps the process live; readiness reports the reason rather than crash-looping. */
  readonly startup: Startup
}

/**
 * The whole HTTP surface. Route order is the contract: `/health` and `/api`
 * match before the client fallback so they can never return HTML, and the
 * `/api` guards register before any route they protect. Whether the
 * installation has services is decided once, here, rather than per request.
 */
export function createApp(deps: AppDependencies): Hono {
  const app = new Hono()

  app.use('*', securityHeaders())
  app.use('*', requestLogging(deps.logger))

  app.get('/health/live', (c) => c.json<Liveness>({ status: 'live' }))

  app.get('/health/ready', (c) => {
    const failure = readinessFailure(deps)
    return failure
      ? c.json<ReadinessBody>({ status: 'unready', reason: failure }, 503)
      : c.json<ReadinessBody>({ status: 'ready' })
  })

  app.all('/health/*', (c) => apiError(c, 404, 'not_found', 'Unknown health route'))

  app.use('/api/*', noStoreByDefault())

  if (deps.startup.kind === 'ready') {
    const { services } = deps.startup
    app.use('/api/*', sameOrigin({ trustProxyHeaders: deps.config.trustProxyHeaders }))
    app.use('/api/*', requireSession(services.authentication))

    app.route(
      '/api/auth',
      authRoutes({
        authentication: services.authentication,
        settings: services.settings,
        clock: deps.clock,
        trustProxyHeaders: deps.config.trustProxyHeaders,
      }),
    )

    app.route('/api', settingsRoutes({ settings: services.settings, clock: deps.clock }))

    app.route('/api', exportRoutes({ db: services.db, settings: services.settings, clock: deps.clock }))

    app.route(
      '/api',
      feedRoutes({
        subscriptions: services.subscriptions,
        poll: services.poll,
        preview: services.preview,
        refresh: services.refresh,
        digest: services.digest,
        nudgeScheduler: () => services.scheduler.nudge(),
      }),
    )

    app.route('/api', libraryRoutes({ library: services.library }))

    app.route('/api', readerRoutes({ readerItems: services.readerItems, reader: services.reader }))

    app.route('/api', searchRoutes({ search: services.search }))

    app.route(
      '/api',
      imageRoutes({
        images: services.images,
        signature: services.imageSignature,
        clock: deps.clock,
        trustProxyHeaders: deps.config.trustProxyHeaders,
      }),
    )

    app.get('/api/meta', (c) => c.json<ServiceMeta>({ name: 'simple-rss', version: VERSION }))

    app.all('/api/*', (c) => apiError(c, 404, 'not_found', 'Unknown API route'))
  } else {
    app.all('/api/*', (c) => apiError(c, 503, 'unavailable', 'Service is not ready'))
  }

  app.use('*', staticAssets({ root: deps.config.clientDir }))

  app.notFound((c) => apiError(c, 404, 'not_found', 'Not found'))

  app.onError((error, c) => {
    deps.logger.error('request.failed', { method: c.req.method, path: c.req.path, error })
    return apiError(c, 500, 'internal_error', 'Internal error')
  })

  return app
}

/**
 * The startup failure first, then the volume — a mounted-but-full disk only
 * reveals itself on a real write. The Setup Secret is checked last because it
 * needs the database to know whether it is still required.
 */
function readinessFailure(deps: AppDependencies): string | undefined {
  if (deps.startup.kind === 'failed') return deps.startup.reason
  const { services } = deps.startup

  try {
    assertWritable(services.db, deps.clock.now())
  } catch (error) {
    deps.logger.error('readiness.write_probe_failed', { error })
    return 'database is not writable'
  }

  return services.authentication.setupBlocker()
}

/**
 * Nothing the API answers may sit in a cache, shared or private — including
 * its 404s and 500s. A route that may be cached (Reader extraction, proxied
 * images) says so with its own `Cache-Control`, which this leaves alone.
 */
function noStoreByDefault(): MiddlewareHandler {
  return async (c, next) => {
    await next()
    if (!c.res.headers.has('Cache-Control')) c.header('Cache-Control', 'no-store')
  }
}

/** One record per request; query strings are omitted — they carry search terms and signed image URLs. */
function requestLogging(logger: Logger): MiddlewareHandler {
  const scoped = logger.child({ component: 'http' })

  return async (c, next) => {
    const startedAt = performance.now()
    await next()

    const level = c.req.path.startsWith('/health/') ? 'debug' : 'info'
    scoped[level]('request.completed', {
      method: c.req.method,
      path: c.req.path,
      status: c.res.status,
      durationMs: elapsedMs(startedAt),
    })
  }
}
