import { join } from 'node:path'
import { afterEach } from 'vitest'
import type { Services } from '../../src/server/app.js'
import { DATABASE_FILE, type Config } from '../../src/server/config.js'
import { createLogger, type LogRecord } from '../../src/server/logger.js'
import type { DrizzleDatabase } from '../../src/server/persistence/database.js'
import type { InstallationSettingsStore } from '../../src/server/persistence/installation-settings.js'
import type { RetentionLimits } from '../../src/server/retention/retention-service.js'
import type { PollSchedulerLimits } from '../../src/server/subscriptions/poll-scheduler.js'
import type { Retrieval } from '../../src/server/upstream/retrieval.js'
import { bootService, type BootedService } from './boot-service.js'
import { ManualClock } from './manual-clock.js'
import { makeTempDataDir } from './temp-dir.js'
import { UpstreamFixtures } from './upstream-fixtures.js'

export { SETUP_SECRET, USER_PASSWORD } from './boot-service.js'

export interface HarnessOptions {
  /** Reuse an existing data directory, e.g. to model a container replacement. */
  readonly dataDir?: string
  /** Extra environment for `loadConfig`, so tests exercise real parsing. */
  readonly env?: Record<string, string>
  readonly clock?: ManualClock
  readonly upstream?: UpstreamFixtures
  /** Scripts the outbound boundary's answers directly instead of serving `upstream` through it. */
  readonly retrieval?: Retrieval
  /** Built client bundle to serve. Omitted means "no client on disk". */
  readonly clientDir?: string
  /** Shrinks the polling batch or concurrency below the production defaults. */
  readonly scheduling?: PollSchedulerLimits
  /** Shrinks the retention sweep batch below the production default. */
  readonly retention?: RetentionLimits
  readonly readerWorkerUrl?: URL
  readonly readerBudgetMs?: number
}

export interface TestService {
  readonly url: string
  readonly config: Config
  readonly dataDir: string
  readonly clock: ManualClock
  readonly upstream: UpstreamFixtures
  /** The outbound boundary the service was wired with: hardened over `upstream`, or the scripted one. */
  readonly retrieval: Retrieval
  /** Throws when startup failed; a degraded-startup test reads `/health/ready` instead. */
  readonly settings: InstallationSettingsStore
  /** Throws when startup failed; a degraded-startup test reads `/health/ready` instead. */
  readonly database: DrizzleDatabase
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

const running: BootedService[] = []

/**
 * Boots the complete service through `bootService`, with time under test
 * control and every log record and login delay captured. Whatever a test
 * leaves running is stopped after it.
 */
export async function startTestService(options: HarnessOptions = {}): Promise<TestService> {
  const dataDir = options.dataDir ?? (await makeTempDataDir())
  const clock = options.clock ?? new ManualClock()
  const upstream = options.upstream ?? new UpstreamFixtures()
  const logs: LogRecord[] = []
  const sleeps: number[] = []

  const boot = async () => {
    const started = await bootService({
      dataDir,
      env: {
        SHUTDOWN_GRACE_MS: '2000',
        TRUST_PROXY_HEADERS: 'true',
        ...(options.clientDir ? { CLIENT_DIR: options.clientDir } : {}),
        ...options.env,
      },
      upstream,
      retrieval: options.retrieval,
      clock,
      logger: createLogger({ level: 'debug', now: () => clock.now(), sink: (record) => void logs.push(record) }),
      sleep: async (milliseconds) => void sleeps.push(milliseconds),
      scheduling: { nudges: false, ...options.scheduling },
      ...(options.retention ? { retention: options.retention } : {}),
      ...(options.readerWorkerUrl ? { readerWorkerUrl: options.readerWorkerUrl } : {}),
      ...(options.readerBudgetMs === undefined ? {} : { readerBudgetMs: options.readerBudgetMs }),
    })
    running.push(started)
    return started
  }

  let service = await boot()

  const services = (): Services => {
    if (!service.services) throw new Error('the service started unready; read /health/ready for the reason')
    return service.services
  }

  return {
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
      return services().settings
    },
    get database() {
      return services().db
    },
    logs,
    sleeps,
    fetch: (path, init) => fetch(new URL(path, service.url), init),
    wakeScheduler: () => services().scheduler.tick(),
    async restart() {
      await stop(service)
      service = await boot()
    },
    stop: () => stop(service),
  }
}

afterEach(async () => {
  const leftover = running.splice(0, running.length)
  await Promise.all(leftover.map((service) => service.stop()))
})

async function stop(service: BootedService): Promise<void> {
  await service.stop()
  const index = running.indexOf(service)
  if (index >= 0) running.splice(index, 1)
}

/** Path to the database file a harness created, for direct SQLite assertions. */
export function databasePathOf(harness: TestService): string {
  return join(harness.dataDir, DATABASE_FILE)
}
