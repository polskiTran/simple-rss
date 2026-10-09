import { randomBytes } from 'node:crypto'
import { Server } from 'node:http'
import { serve } from '@hono/node-server'
import type { Hono } from 'hono'
import { createApp, type Services, type Startup } from './app.js'
import { createAuthentication } from './auth/authentication.js'
import type { Sleeper } from './auth/sleeper.js'
import { systemClock, type Clock } from './clock.js'
import type { Config } from './config.js'
import { DigestService } from './digest/digest-service.js'
import { ImageService } from './images/image-service.js'
import { createImageUrlSignature, IMAGE_URL_KEY_BYTES } from './images/image-url-signature.js'
import { LibraryService } from './library/library-service.js'
import { createLogger, type Logger } from './logger.js'
import { openDatabase, type DrizzleDatabase } from './persistence/database.js'
import { InstallationSettingsStore } from './persistence/installation-settings.js'
import { applyMigrations } from './persistence/migrations.js'
import { ReaderExtractor } from './reader/reader-extractor.js'
import { ReaderItems } from './reader/reader-items.js'
import { ReaderService } from './reader/reader-service.js'
import { RetentionService, type RetentionLimits } from './retention/retention-service.js'
import { SearchService } from './search/search-service.js'
import { FeedAvailabilityLedger } from './subscriptions/feed-availability.js'
import { FeedPoll } from './subscriptions/feed-poll.js'
import { FeedRefresh } from './subscriptions/feed-refresh.js'
import { PollScheduler, type PollSchedulerLimits } from './subscriptions/poll-scheduler.js'
import { SubscriptionService } from './subscriptions/subscription-service.js'
import { createNetworkRetrieval, type Retrieval } from './upstream/retrieval.js'

export interface ServiceOptions {
  readonly config: Config
  /** Overrides `config.port`. Tests pass 0 for any free port; `config.ts` still refuses 0 from a host. */
  readonly port?: number
  readonly logger?: Logger
  readonly clock?: Clock
  readonly retrieval?: Retrieval
  readonly sleep?: Sleeper
  readonly scheduling?: PollSchedulerLimits
  readonly retention?: RetentionLimits
  readonly readerWorkerUrl?: URL
  readonly readerBudgetMs?: number
}

/** A listening service. `stop()` is the only way down: it drains before closing the database. */
export interface RunningService {
  /** Undefined when startup failed: `/health/ready` answers 503 with the reason and `/api` answers 503. */
  readonly services: Services | undefined
  /** The port actually bound, which differs from the request when it was 0. */
  readonly port: number
  /** Origin a client can call, e.g. `http://127.0.0.1:53124`. */
  readonly url: string
  /** Stops accepting connections, drains in-flight work, closes the database. */
  stop(): Promise<void>
}

const IDLE_SWEEP_MS = 20

/**
 * The composition root. A startup failure is reported rather than thrown: the
 * process listens anyway, `/health/live` stays green, `/health/ready` answers
 * 503 with the step that failed, and `/api` answers 503 so no traffic reaches a
 * half-built installation. Only a socket that cannot bind rejects.
 */
export async function startService(options: ServiceOptions): Promise<RunningService> {
  const { config } = options
  const logger = options.logger ?? createLogger({ level: config.logLevel })
  const clock = options.clock ?? systemClock
  const retrieval =
    options.retrieval ??
    createNetworkRetrieval({
      logger,
      self: new URL(config.publicOrigin),
    })

  const startup = compose(options, { logger, clock, retrieval })
  const services = startup.kind === 'ready' ? startup.services : undefined
  services?.scheduler.start()

  const app = createApp({ config, clock, logger, startup })
  const { server, port } = await listen(app, options.port ?? config.port)
  logger.info('server.started', { port, dataDir: config.dataDir })

  /**
   * Whatever outlives the grace period is cut off, because a platform that
   * sent SIGTERM sends SIGKILL next.
   */
  const shutdown = async (): Promise<void> => {
    const graceMs = config.shutdownGraceMs
    logger.info('server.stopping', { graceMs })
    services?.scheduler.stop()
    await drain(server, graceMs, logger)
    await services?.reader.close()
    services?.db.$client.close()
    logger.info('server.stopped')
  }

  let stopped: Promise<void> | undefined

  return {
    services,
    port,
    url: `http://127.0.0.1:${port}`,
    stop() {
      stopped ??= shutdown()
      return stopped
    },
  }
}

/**
 * Builds every domain service once. The reason names the step that failed;
 * the log carries the error itself. Whatever was opened before the failure
 * is closed again, so a failed startup holds no database handle or worker.
 */
function compose(
  options: ServiceOptions,
  { logger, clock, retrieval }: { readonly logger: Logger; readonly clock: Clock; readonly retrieval: Retrieval },
): Startup {
  const { config } = options
  let reason = 'database could not be opened'
  let db: DrizzleDatabase | undefined
  let extractor: ReaderExtractor | undefined

  try {
    db = openDatabase(config.databasePath)

    reason = 'migrations failed'
    const applied = applyMigrations(db, clock)
    logger.info('startup.migrations_applied', { databasePath: config.databasePath, applied })

    reason = 'services could not start'
    const settings = new InstallationSettingsStore(db)
    const authentication = createAuthentication({
      db,
      clock,
      logger,
      setupSecret: config.setupSecret,
      ...(options.sleep ? { sleep: options.sleep } : {}),
    })
    const availability = new FeedAvailabilityLedger({ db, clock, logger })
    const subscriptions = new SubscriptionService({ db, clock, settings, logger })
    const poll = new FeedPoll({ db, retrieval, clock, logger, subscriptions, availability })
    const refresh = new FeedRefresh({ clock, poll })

    const digest = new DigestService({ db, clock, settings })
    const library = new LibraryService({ db, clock, settings })
    const imageSigningKey = randomBytes(IMAGE_URL_KEY_BYTES)
    const imageSignature = createImageUrlSignature({ key: imageSigningKey, clock })
    const images = new ImageService({ db, retrieval })
    extractor = new ReaderExtractor({
      clock,
      imageSigningKey,
      logger,
      workerUrl: options.readerWorkerUrl,
    })
    const readerItems = new ReaderItems({ db, clock, settings, digest, signImageUrl: imageSignature.sign })
    const reader = new ReaderService({
      db,
      clock,
      retrieval,
      extractor,
      logger,
      ...(options.readerBudgetMs === undefined ? {} : { budgetMs: options.readerBudgetMs }),
    })
    const search = new SearchService({ db, clock, settings })
    const retention = new RetentionService({ db, clock, logger, ...options.retention })

    const services = {
      db,
      authentication,
      settings,
      subscriptions,
      refresh,
      digest,
      library,
      readerItems,
      reader,
      search,
      images,
      imageSignature,
      scheduler: new PollScheduler({ subscriptions, refresh, retention, logger, ...options.scheduling }),
    } satisfies Services
    return { kind: 'ready', services }
  } catch (error) {
    logger.error('startup.failed', { databasePath: config.databasePath, reason, error: error })
    extractor?.close().catch((closeError) => logger.error('startup.reader_close_failed', { error: closeError }))
    db?.$client.close()
    return { kind: 'failed', reason }
  }
}

interface ListeningServer {
  readonly server: Server
  readonly port: number
}

/** `serve` defaults to Node's HTTP/1 server when no custom server factory is supplied. */
function listen(app: Hono, port: number): Promise<ListeningServer> {
  const { promise, resolve, reject } = Promise.withResolvers<ListeningServer>()
  const candidate = serve({ fetch: app.fetch, port }, (address) => {
    if (candidate instanceof Server) {
      resolve({ server: candidate, port: address.port })
    } else {
      candidate.close()
      reject(new Error('Hono created an unexpected HTTP/2 server'))
    }
  })
  candidate.once('error', reject)
  return promise
}

/** Resolves once every connection has closed, forcing the stragglers after `graceMs`. */
function drain(server: Server, graceMs: number, logger: Logger): Promise<void> {
  return new Promise<void>((resolve) => {
    const forceTimer = setTimeout(() => {
      logger.warn('server.stop_forced', { graceMs })
      server.closeAllConnections()
    }, graceMs)
    forceTimer.unref()

    // A keep-alive socket goes idle only after its response flushes; a single
    // sweep would miss connections still writing and wait out the full grace.
    const sweep = setInterval(() => server.closeIdleConnections(), IDLE_SWEEP_MS)
    sweep.unref()

    server.close(() => {
      clearTimeout(forceTimer)
      clearInterval(sweep)
      resolve()
    })
    server.closeIdleConnections()
  })
}
