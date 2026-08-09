import { Hono } from 'hono'
import type { Liveness, Readiness as ReadinessBody, ServiceMeta } from '../shared/api.js'
import { VERSION } from '../shared/version.js'
import type { Authentication } from './auth/authentication.js'
import type { Clock } from './clock.js'
import type { Config } from './config.js'
import type { DigestService } from './digest/digest-service.js'
import type { LibraryService } from './library/library-service.js'
import type { Logger } from './logger.js'
import { assertWritable, type SqliteDatabase } from './persistence/database.js'
import type { InstallationSettingsStore } from './persistence/installation-settings.js'
import type { ReaderService } from './reader/reader-service.js'
import type { Readiness } from './readiness.js'
import type { FeedRefresh } from './subscriptions/feed-refresh.js'
import type { SubscriptionService } from './subscriptions/subscription-service.js'
import { authRoutes, PUBLIC_API_PATHS } from './http/auth-routes.js'
import { feedRoutes } from './http/feed-routes.js'
import { libraryRoutes } from './http/library-routes.js'
import { readerRoutes } from './http/reader-routes.js'
import { settingsRoutes } from './http/settings-routes.js'
import { requireSession } from './http/require-session.js'
import { sameOrigin } from './http/same-origin.js'
import { securityHeaders } from './http/security-headers.js'
import { staticAssets } from './http/static-assets.js'

export interface AppDependencies {
  readonly config: Config
  readonly clock: Clock
  readonly logger: Logger
  readonly readiness: Readiness
  /**
   * Absent while the database could not be opened. Readiness reports that
   * rather than the process crash-looping past the operator.
   */
  readonly database: () => SqliteDatabase | undefined
  /** Absent for the same reason the database is. */
  readonly authentication: () => Authentication | undefined
  readonly settings: () => InstallationSettingsStore | undefined
  /** Feed work is absent only while startup could not open the database. */
  readonly subscriptions: () => SubscriptionService | undefined
  readonly refresh: () => FeedRefresh | undefined
  readonly digest: () => DigestService | undefined
  readonly library: () => LibraryService | undefined
  readonly reader: () => ReaderService | undefined
}

/**
 * The whole HTTP surface: health, the JSON API, and the built client, in one
 * process. Route order is the contract — `/health` and `/api` are matched
 * before the client fallback, so they can never return HTML, and the two
 * `/api` guards are registered before any route they protect.
 */
export function createApp(deps: AppDependencies): Hono {
  const app = new Hono()

  app.use('*', securityHeaders())
  app.use('*', requestLogging(deps.logger))

  // Health answers before the guards, because a platform probe holds no
  // session and must still be able to see why an installation is unready.
  app.get('/health/live', (c) => c.json<Liveness>({ status: 'live' }))

  app.get('/health/ready', (c) => {
    const failure = readinessFailure(deps)
    return failure
      ? c.json<ReadinessBody>({ status: 'unready', reason: failure }, 503)
      : c.json<ReadinessBody>({ status: 'ready' })
  })

  app.all('/health/*', (c) =>
    c.json({ error: { code: 'not_found', message: 'Unknown health route' } }, 404),
  )

  app.use('/api/*', sameOrigin({ trustProxyHeaders: deps.config.trustProxyHeaders }))
  app.use(
    '/api/*',
    requireSession({
      authentication: deps.authentication,
      isPublic: (path) => PUBLIC_API_PATHS.has(path),
    }),
  )

  app.route(
    '/api/auth',
    authRoutes({
      authentication: deps.authentication,
      settings: deps.settings,
      clock: deps.clock,
      trustProxyHeaders: deps.config.trustProxyHeaders,
    }),
  )

  app.route('/api', settingsRoutes({ settings: deps.settings, clock: deps.clock }))

  app.route(
    '/api',
    feedRoutes({
      subscriptions: deps.subscriptions,
      refresh: deps.refresh,
      digest: deps.digest,
    }),
  )

  app.route('/api', libraryRoutes({ library: deps.library }))

  app.route('/api', readerRoutes({ reader: deps.reader }))

  app.get('/api/meta', (c) => c.json<ServiceMeta>({ name: 'simple-rss', version: VERSION }))

  app.all('/api/*', (c) =>
    c.json({ error: { code: 'not_found', message: 'Unknown API route' } }, 404),
  )

  app.use('*', staticAssets({ root: deps.config.clientDir }))

  app.notFound((c) => c.json({ error: { code: 'not_found', message: 'Not found' } }, 404))

  app.onError((error, c) => {
    deps.logger.error('request.failed', { method: c.req.method, path: c.req.path, error })
    return c.json({ error: { code: 'internal_error', message: 'Internal error' } }, 500)
  })

  return app
}

/**
 * The reason readiness is closed, or `undefined` when the service can take
 * traffic. Startup state is checked first, then the volume, because a
 * mounted-but-full disk only reveals itself on a real write.
 *
 * The setup secret is checked last because it needs the database to know
 * whether it is still required, and it is checked at all because an unclaimed
 * installation with no way to claim it can serve nothing but a dead end.
 */
function readinessFailure(deps: AppDependencies): string | undefined {
  const state = deps.readiness.state
  if (state.kind === 'starting') return 'starting'
  if (state.kind === 'failed') return state.reason

  const db = deps.database()
  if (!db) return 'database is not open'

  try {
    assertWritable(db, deps.clock.now())
  } catch (error) {
    deps.logger.error('readiness.write_probe_failed', { error })
    return 'database is not writable'
  }

  const authentication = deps.authentication()
  if (!authentication) return 'authentication is not available'

  return authentication.setupBlocker()
}

/**
 * One record per request. Paths are logged without query strings, which can
 * carry search terms and, later, signed image URLs.
 */
function requestLogging(logger: Logger) {
  const scoped = logger.child({ component: 'http' })

  return async (c: { req: { method: string; path: string }; res: Response }, next: () => Promise<void>) => {
    const startedAt = process.hrtime.bigint()
    await next()
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6

    // Platform health probes run every few seconds; at info level they would
    // drown out everything an operator actually wants to read.
    const level = c.req.path.startsWith('/health/') ? 'debug' : 'info'
    scoped[level]('request.completed', {
      method: c.req.method,
      path: c.req.path,
      status: c.res.status,
      durationMs: Math.round(durationMs * 100) / 100,
    })
  }
}
