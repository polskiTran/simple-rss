import type { Hono } from 'hono'
import { createApp } from './app.js'
import { createAuthentication, type Authentication } from './auth/authentication.js'
import type { Sleeper } from './auth/sleeper.js'
import { systemClock, type Clock } from './clock.js'
import type { Config } from './config.js'
import { createLogger, type Logger } from './logger.js'
import { openDatabase, type SqliteDatabase } from './persistence/database.js'
import { InstallationSettingsStore } from './persistence/installation-settings.js'
import { applyMigrations } from './persistence/migrations.js'
import { Readiness } from './readiness.js'
import type { ResolveAddresses } from './upstream/destination.js'
import type { HttpClient } from './upstream/http-client.js'
import { createNetworkHttpClient } from './upstream/network-client.js'
import { createRetrieval, type Retrieval } from './upstream/retrieval.js'

export interface ServiceOptions {
  readonly config: Config
  readonly logger?: Logger
  readonly clock?: Clock
  readonly httpClient?: HttpClient
  /** Overridden by tests so a stubbed host resolves without asking real DNS. */
  readonly resolveAddresses?: ResolveAddresses
  /** Overridden by tests so progressive login delays cost no wall-clock time. */
  readonly sleep?: Sleeper
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
  const httpClient = options.httpClient ?? createNetworkHttpClient()
  const retrieval = createRetrieval({
    httpClient,
    logger,
    ...(options.resolveAddresses ? { resolve: options.resolveAddresses } : {}),
    // Everything private is refused without being told; the installation's own
    // public origin is the one destination only configuration can name.
    ...(config.publicOrigin ? { self: [config.publicOrigin] } : {}),
  })
  const readiness = new Readiness()

  let database: SqliteDatabase | undefined
  let settings: InstallationSettingsStore | undefined
  let authentication: Authentication | undefined

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
    retrieval,
    database: () => database,
    authentication: () => authentication,
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
    close() {
      database?.close()
      database = undefined
      settings = undefined
      authentication = undefined
    },
  }
}
