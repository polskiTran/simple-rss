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
import { networkHttpClient, type HttpClient } from './upstream/http-client.js'

export interface ServiceOptions {
  readonly config: Config
  readonly logger?: Logger
  readonly clock?: Clock
  readonly httpClient?: HttpClient
  /** Overridden by tests so progressive login delays cost no wall-clock time. */
  readonly sleep?: Sleeper
}

export interface Service {
  readonly app: Hono
  readonly config: Config
  readonly logger: Logger
  readonly clock: Clock
  readonly readiness: Readiness
  /** Undefined only when startup failed to open the database. */
  readonly database: SqliteDatabase | undefined
  readonly settings: InstallationSettingsStore | undefined
  readonly authentication: Authentication | undefined
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
  const httpClient = options.httpClient ?? networkHttpClient
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
    httpClient,
    database: () => database,
    authentication: () => authentication,
  })

  return {
    app,
    config,
    logger,
    clock,
    readiness,
    get database() {
      return database
    },
    get settings() {
      return settings
    },
    get authentication() {
      return authentication
    },
    close() {
      database?.close()
      database = undefined
      settings = undefined
      authentication = undefined
    },
  }
}
