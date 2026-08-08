import { Hono } from 'hono'
import type { Liveness, Readiness as ReadinessBody, ServiceMeta } from '../shared/api.js'
import { VERSION } from '../shared/version.js'
import type { Clock } from './clock.js'
import type { Config } from './config.js'
import type { Logger } from './logger.js'
import { assertWritable, type SqliteDatabase } from './persistence/database.js'
import type { Readiness } from './readiness.js'
import { securityHeaders } from './http/security-headers.js'
import { staticAssets } from './http/static-assets.js'
import type { HttpClient } from './upstream/http-client.js'

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
  /** Unused until Feed retrieval lands; wired now so the seam exists. */
  readonly httpClient: HttpClient
}

/**
 * The whole HTTP surface: health, the JSON API, and the built client, in one
 * process. Route order is the contract — `/health` and `/api` are matched
 * before the client fallback, so they can never return HTML.
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
  return undefined
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
