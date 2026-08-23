import { Hono } from 'hono'
import type { Liveness, Readiness as ReadinessBody, ServiceMeta } from '../shared/api.js'
import { VERSION } from '../shared/version.js'
import type { Authentication } from './auth/authentication.js'
import type { Clock } from './clock.js'
import type { Config } from './config.js'
import type { DigestService } from './digest/digest-service.js'
import type { ImageService } from './images/image-service.js'
import type { ImageUrlSignature } from './images/image-url-signature.js'
import type { LibraryService } from './library/library-service.js'
import type { Logger } from './logger.js'
import { assertWritable, type DrizzleDatabase } from './persistence/database.js'
import type { InstallationSettingsStore } from './persistence/installation-settings.js'
import type { ReaderService } from './reader/reader-service.js'
import type { Readiness } from './readiness.js'
import type { SearchService } from './search/search-service.js'
import type { FeedRefresh } from './subscriptions/feed-refresh.js'
import type { SubscriptionService } from './subscriptions/subscription-service.js'
import { authRoutes, PUBLIC_API_PATHS } from './http/auth-routes.js'
import { exportRoutes } from './http/export-routes.js'
import { feedRoutes } from './http/feed-routes.js'
import { imageRoutes } from './http/image-routes.js'
import { libraryRoutes } from './http/library-routes.js'
import { readerRoutes } from './http/reader-routes.js'
import { searchRoutes } from './http/search-routes.js'
import { settingsRoutes } from './http/settings-routes.js'
import { requireSession } from './http/require-session.js'
import { unavailable } from './http/responses.js'
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
  readonly refresh: FeedRefresh
  readonly digest: DigestService
  readonly library: LibraryService
  readonly reader: ReaderService
  readonly search: SearchService
  readonly images: ImageService
  readonly imageSignature: ImageUrlSignature
  /** Asks the scheduler for an immediate look at the due frontier. */
  nudgeScheduler(): void
}

export interface AppDependencies {
  readonly config: Config
  readonly clock: Clock
  readonly logger: Logger
  readonly readiness: Readiness
  /** Absent while startup could not open the database; readiness reports that rather than crash-looping. */
  readonly services: Services | undefined
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

  app.all('/health/*', (c) => c.json({ error: { code: 'not_found', message: 'Unknown health route' } }, 404))

  const services = deps.services
  if (services) {
    app.use('/api/*', sameOrigin({ trustProxyHeaders: deps.config.trustProxyHeaders }))
    app.use(
      '/api/*',
      requireSession({
        authentication: services.authentication,
        isPublic: (path) => PUBLIC_API_PATHS.has(path),
      }),
    )

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
        refresh: services.refresh,
        digest: services.digest,
        nudgeScheduler: services.nudgeScheduler,
      }),
    )

    app.route('/api', libraryRoutes({ library: services.library }))

    app.route('/api', readerRoutes({ reader: services.reader }))

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

    app.all('/api/*', (c) => c.json({ error: { code: 'not_found', message: 'Unknown API route' } }, 404))
  } else {
    app.all('/api/*', unavailable)
  }

  app.use('*', staticAssets({ root: deps.config.clientDir }))

  app.notFound((c) => c.json({ error: { code: 'not_found', message: 'Not found' } }, 404))

  app.onError((error, c) => {
    deps.logger.error('request.failed', { method: c.req.method, path: c.req.path, error })
    return c.json({ error: { code: 'internal_error', message: 'Internal error' } }, 500)
  })

  return app
}

/**
 * Startup state first, then the volume — a mounted-but-full disk only reveals
 * itself on a real write. The Setup Secret is checked last because it needs
 * the database to know whether it is still required.
 */
function readinessFailure(deps: AppDependencies): string | undefined {
  const state = deps.readiness.state
  if (state.kind === 'starting') return 'starting'
  if (state.kind === 'failed') return state.reason

  const db = deps.services?.db
  if (!db) return 'database is not open'

  try {
    assertWritable(db, deps.clock.now())
  } catch (error) {
    deps.logger.error('readiness.write_probe_failed', { error })
    return 'database is not writable'
  }

  const authentication = deps.services?.authentication
  if (!authentication) return 'authentication is not available'

  return authentication.setupBlocker()
}

/** One record per request; query strings are omitted — they carry search terms and signed image URLs. */
function requestLogging(logger: Logger) {
  const scoped = logger.child({ component: 'http' })

  return async (c: { req: { method: string; path: string }; res: Response }, next: () => Promise<void>) => {
    const startedAt = process.hrtime.bigint()
    await next()
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6

    const level = c.req.path.startsWith('/health/') ? 'debug' : 'info'
    scoped[level]('request.completed', {
      method: c.req.method,
      path: c.req.path,
      status: c.res.status,
      durationMs: Math.round(durationMs * 100) / 100,
    })
  }
}
