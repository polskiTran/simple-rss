import type { Hono } from 'hono'
import { createApp } from './app.js'
import { createAuthentication, type Authentication } from './auth/authentication.js'
import type { Sleeper } from './auth/sleeper.js'
import { systemClock, type Clock } from './clock.js'
import type { Config } from './config.js'
import { DigestService } from './digest/digest-service.js'
import { createLogger, type Logger } from './logger.js'
import { openDatabase, type SqliteDatabase } from './persistence/database.js'
import { InstallationSettingsStore } from './persistence/installation-settings.js'
import { applyMigrations } from './persistence/migrations.js'
import { FeedRefresh } from './subscriptions/feed-refresh.js'
import { PollScheduler, type PollSchedulerLimits } from './subscriptions/poll-scheduler.js'
import { SubscriptionService } from './subscriptions/subscription-service.js'
import { Readiness } from './readiness.js'
import { createNetworkRetrieval, type Retrieval } from './upstream/retrieval.js'

export interface ServiceOptions {
  readonly config: Config
  readonly logger?: Logger
  readonly clock?: Clock
  /** Tests replace the deep retrieval module, never its raw network adapter. */
  readonly retrieval?: Retrieval
  /** Overridden by tests so progressive login delays cost no wall-clock time. */
  readonly sleep?: Sleeper
  /** Tests shrink the polling batch and concurrency; production uses defaults. */
  readonly scheduling?: PollSchedulerLimits
}

export interface Service {
  readonly app: Hono
  readonly config: Config
  readonly logger: Logger
  readonly clock: Clock
  readonly readiness: Readiness
  /** The one door to the outside world, shared by every later retrieval. */
  readonly retrieval: Retrieval
  /** Undefined only when startup failed to open the database. */
  readonly database: SqliteDatabase | undefined
  readonly settings: InstallationSettingsStore | undefined
  /** The in-process background poller; absent only when startup failed. */
  readonly scheduler: PollScheduler | undefined
  close(): void
}

/**
 * The composition root. Opens the database on the durable volume, migrates it,
 * and wires the HTTP app around the result.
 *
 * A startup failure is recorded rather than thrown: the process stays up and
 * answers liveness so an operator can read the reason, while readiness stays
 * closed so no traffic is routed to a half-built installation.
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

  let database: SqliteDatabase | undefined
  let settings: InstallationSettingsStore | undefined
  let authentication: Authentication | undefined
  let subscriptions: SubscriptionService | undefined
  let refresh: FeedRefresh | undefined
  let digest: DigestService | undefined
  let scheduler: PollScheduler | undefined

  try {
    database = openDatabase(config.databasePath)
    const applied = applyMigrations(database, clock)
    settings = new InstallationSettingsStore(database)
    authentication = createAuthentication({
      database,
      clock,
      logger,
      setupSecret: config.setupSecret,
      ...(options.sleep ? { sleep: options.sleep } : {}),
    })
    subscriptions = new SubscriptionService({ database, retrieval, clock, settings, logger })
    refresh = new FeedRefresh({ clock, subscriptions })

    digest = new DigestService({ database, clock, settings })
    scheduler = new PollScheduler({ subscriptions, refresh, logger, ...options.scheduling })
    scheduler.start()
    readiness.markReady()
    logger.info('startup.migrations_applied', {
      databasePath: config.databasePath,
      applied,
    })
  } catch (error) {
    readiness.markFailed('migrations failed')
    logger.error('startup.migrations_failed', { databasePath: config.databasePath, error })
  }

  const app = createApp({
    config,
    clock,
    logger,
    readiness,
    database: () => database,
    authentication: () => authentication,
    settings: () => settings,
    subscriptions: () => subscriptions,
    refresh: () => refresh,
    digest: () => digest,
  })

  return {
    app,
    config,
    logger,
    clock,
    readiness,
    retrieval,
    get database() {
      return database
    },
    get settings() {
      return settings
    },
    get scheduler() {
      return scheduler
    },
    close() {
      // The scheduler stops before the database closes, so no further wake
      // lands on a closed handle.
      scheduler?.stop()
      scheduler = undefined
      database?.close()
      database = undefined
      settings = undefined
      authentication = undefined
      subscriptions = undefined
      refresh = undefined
      digest = undefined
    },
  }
}
