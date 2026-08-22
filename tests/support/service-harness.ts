import { join } from 'node:path'
import { afterEach } from 'vitest'
import { DATABASE_FILE, loadConfig, type Config } from '../../src/server/config.js'
import { createLogger, type LogRecord } from '../../src/server/logger.js'
import type { SqliteDatabase } from '../../src/server/persistence/database.js'
import type { InstallationSettingsStore } from '../../src/server/persistence/installation-settings.js'
import type { RetentionLimits } from '../../src/server/retention/retention-service.js'
import { startService, type RunningService } from '../../src/server/server.js'
import type { PollSchedulerLimits } from '../../src/server/subscriptions/poll-scheduler.js'
import { createRetrieval, type Retrieval } from '../../src/server/upstream/retrieval.js'
import { ManualClock } from './manual-clock.js'
import { makeTempDataDir } from './temp-dir.js'
import { UpstreamFixtures } from './upstream-fixtures.js'

export const SETUP_SECRET = 'a-deployment-setup-secret'

export const USER_PASSWORD = 'a-calm-reading-password'

export interface HarnessOptions {
  /** Reuse an existing data directory, e.g. to model a container replacement. */
  readonly dataDir?: string
  /** Extra environment for `loadConfig`, so tests exercise real parsing. */
  readonly env?: Record<string, string>
  readonly clock?: ManualClock
  readonly upstream?: UpstreamFixtures
  /** Built client bundle to serve. Omitted means "no client on disk". */
  readonly clientDir?: string
  /** Shrinks the polling batch or concurrency below the production defaults. */
  readonly scheduling?: PollSchedulerLimits
  /**
   * Wraps the boundary the service is handed. The fixtures stand in for
   * publishers; an outcome this installation itself produces — a `busy`
   * refusal — is staged here.
   */
  readonly retrieval?: (boundary: Retrieval) => Retrieval
  /** Shrinks the retention sweep batch below the production default. */
  readonly retention?: RetentionLimits
}

export interface TestService {
  readonly url: string
  readonly config: Config
  readonly dataDir: string
  readonly clock: ManualClock
  readonly upstream: UpstreamFixtures
  /** The boundary the service was handed: its own, or what `HarnessOptions.retrieval` wrapped it in. */
  readonly retrieval: Retrieval
  readonly settings: InstallationSettingsStore | undefined
  readonly database: SqliteDatabase | undefined
  readonly logs: readonly LogRecord[]
  /**
   * Every progressive login delay the service asked for, in order. Nothing
   * actually waited, so rate-limit tests assert on this instead of the clock.
   */
  readonly sleeps: readonly number[]
  /** Same-origin request against the running service; `path` starts with `/`. */
  fetch(path: string, init?: RequestInit): Promise<Response>
  /** One scheduler wake, driven explicitly instead of by the once-per-minute timer. */
  wakeScheduler(): Promise<void>
  /** Stops the process and starts a new one on the same data directory — a container replacement. */
  restart(): Promise<void>
  stop(): Promise<void>
}

const running: RunningService[] = []

/**
 * Boots the complete service — real socket, real SQLite file in a temporary
 * directory, real migrations — with time and upstream HTTP under test control.
 */
export async function startTestService(options: HarnessOptions = {}): Promise<TestService> {
  const dataDir = options.dataDir ?? (await makeTempDataDir())
  const clock = options.clock ?? new ManualClock()
  const upstream = options.upstream ?? new UpstreamFixtures()
  const logs: LogRecord[] = []
  const sleeps: number[] = []

  const config = loadConfig({
    DATA_DIR: dataDir,
    LOG_LEVEL: 'debug',
    SHUTDOWN_GRACE_MS: '2000',
    SETUP_SECRET,
    PUBLIC_ORIGIN: 'https://reader.test',
    TRUST_PROXY_HEADERS: 'true',
    ...(options.clientDir ? { CLIENT_DIR: options.clientDir } : {}),
    ...options.env,
  })

  const boot = async () => {
    const logger = createLogger({
      level: config.logLevel,
      now: () => clock.now(),
      sink: (record) => void logs.push(record),
    })
    const boundary = createRetrieval({
      httpClient: upstream.client,
      resolve: upstream.resolve,
      logger,
      self: new URL(config.publicOrigin),
    })
    const retrieval = options.retrieval?.(boundary) ?? boundary
    const started = await startService({
      config,
      port: 0,
      clock,
      retrieval,
      sleep: async (milliseconds) => void sleeps.push(milliseconds),
      logger,
      scheduling: { nudges: false, ...options.scheduling },
      ...(options.retention ? { retention: options.retention } : {}),
    })
    running.push(started)
    return started
  }

  let service = await boot()

  const harness: TestService = {
    get url() {
      return service.url
    },
    get config() {
      return service.config
    },
    dataDir,
    clock,
    upstream,
    get retrieval() {
      return service.retrieval
    },
    get settings() {
      return service.settings
    },
    get database() {
      return service.database
    },
    logs,
    sleeps,
    fetch: (path, init) => fetch(new URL(path, service.url), init),
    async wakeScheduler() {
      const scheduler = service.scheduler
      if (!scheduler) throw new Error('the service started without a scheduler')
      await scheduler.tick()
    },
    async restart() {
      await service.stop()
      remove(service)
      service = await boot()
    },
    async stop() {
      await service.stop()
      remove(service)
    },
  }

  return harness
}

afterEach(async () => {
  const leftover = running.splice(0, running.length)
  await Promise.all(leftover.map((service) => service.stop()))
})

function remove(service: RunningService): void {
  const index = running.indexOf(service)
  if (index >= 0) running.splice(index, 1)
}

/** Path to the database file a harness created, for direct SQLite assertions. */
export function databasePathOf(harness: TestService): string {
  return join(harness.dataDir, DATABASE_FILE)
}
