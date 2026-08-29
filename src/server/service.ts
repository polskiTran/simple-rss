import { randomBytes } from 'node:crypto'
import type { Hono } from 'hono'
import { createApp, type Services } from './app.js'
import { createAuthentication } from './auth/authentication.js'
import type { Sleeper } from './auth/sleeper.js'
import { systemClock, type Clock } from './clock.js'
import type { Config } from './config.js'
import { DigestService } from './digest/digest-service.js'
import { ImageService } from './images/image-service.js'
import { createImageUrlSignature } from './images/image-url-signature.js'
import { LibraryService } from './library/library-service.js'
import { createLogger, errorForLog, type Logger } from './logger.js'
import { openDatabase, type DrizzleDatabase } from './persistence/database.js'
import { InstallationSettingsStore } from './persistence/installation-settings.js'
import { applyMigrations } from './persistence/migrations.js'
import { ReaderExtractor } from './reader/reader-extractor.js'
import { ReaderService } from './reader/reader-service.js'
import { RetentionService, type RetentionLimits } from './retention/retention-service.js'
import { SearchService } from './search/search-service.js'
import { FeedAvailabilityLedger } from './subscriptions/feed-availability.js'
import { FeedPoll } from './subscriptions/feed-poll.js'
import { FeedRefresh } from './subscriptions/feed-refresh.js'
import { PollScheduler, type PollSchedulerLimits } from './subscriptions/poll-scheduler.js'
import { SubscriptionService } from './subscriptions/subscription-service.js'
import { Readiness } from './readiness.js'
import { createNetworkRetrieval, type Retrieval } from './upstream/retrieval.js'

export interface ServiceOptions {
  readonly config: Config
  readonly logger?: Logger
  readonly clock?: Clock
  readonly retrieval?: Retrieval
  readonly sleep?: Sleeper
  readonly scheduling?: PollSchedulerLimits
  readonly retention?: RetentionLimits
  readonly readerWorkerUrl?: URL
  readonly readerBudgetMs?: number
}

export interface Service {
  readonly app: Hono
  readonly config: Config
  readonly logger: Logger
  readonly clock: Clock
  readonly readiness: Readiness
  /** The single outbound HTTP boundary (ADR 0005), shared by every retrieval. */
  readonly retrieval: Retrieval
  /** Undefined only when startup failed to open the database. */
  readonly database: DrizzleDatabase | undefined
  readonly settings: InstallationSettingsStore | undefined
  /** The in-process background poller; absent only when startup failed. */
  readonly scheduler: PollScheduler | undefined
  shutdown(drain: () => Promise<void>): Promise<void>
}

/**
 * The composition root. A startup failure is recorded rather than thrown: the
 * process stays up to answer liveness with the reason, while readiness stays
 * closed so no traffic reaches a half-built installation.
 */
export function createService(options: ServiceOptions): Service {
  const { config } = options
  const logger = options.logger ?? createLogger({ level: config.logLevel })
  const clock = options.clock ?? systemClock
  const retrieval =
    options.retrieval ??
    createNetworkRetrieval({
      logger,
      self: new URL(config.publicOrigin),
    })
  const readiness = new Readiness()

  let scheduler: PollScheduler | undefined
  let extractor: ReaderExtractor | undefined
  let services: Services | undefined

  try {
    const db = openDatabase(config.databasePath)
    const applied = applyMigrations(db, clock)
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
    const imageSigningKey = randomBytes(32)
    const imageSignature = createImageUrlSignature({ key: imageSigningKey, clock })
    const images = new ImageService({ db, retrieval })
    extractor = new ReaderExtractor({
      clock,
      imageSigningKey,
      logger,
      workerUrl: options.readerWorkerUrl,
    })
    const reader = new ReaderService({
      db,
      clock,
      settings,
      retrieval,
      digest,
      extractor,
      logger,
      ...(options.readerBudgetMs === undefined ? {} : { budgetMs: options.readerBudgetMs }),
    })
    const search = new SearchService({ db, clock, settings })
    const retention = new RetentionService({ db, clock, logger, ...options.retention })
    scheduler = new PollScheduler({ subscriptions, refresh, retention, logger, ...options.scheduling })

    services = {
      db,
      authentication,
      settings,
      subscriptions,
      refresh,
      digest,
      library,
      reader,
      search,
      images,
      imageSignature,
      nudgeScheduler: () => scheduler?.nudge(),
    }

    scheduler.start()
    readiness.markReady()
    logger.info('startup.migrations_applied', {
      databasePath: config.databasePath,
      applied,
    })
  } catch (error) {
    extractor
      ?.close()
      .catch((closeError) => logger.error('startup.reader_close_failed', { error: errorForLog(closeError) }))
    readiness.markFailed('migrations failed')
    logger.error('startup.migrations_failed', { databasePath: config.databasePath, error: errorForLog(error) })
  }

  const app = createApp({ config, clock, logger, readiness, services })

  const shutdown = async (drain: () => Promise<void>): Promise<void> => {
    scheduler?.stop()
    scheduler = undefined
    await drain()
    await services?.reader.close()
    services?.db.$client.close()
    services = undefined
  }

  return {
    app,
    config,
    logger,
    clock,
    readiness,
    retrieval,
    get database() {
      return services?.db
    },
    get settings() {
      return services?.settings
    },
    get scheduler() {
      return scheduler
    },
    shutdown,
  }
}
