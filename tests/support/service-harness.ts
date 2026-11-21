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
  readonly dataDir?: string
  readonly env?: Record<string, string>
  readonly clock?: ManualClock
  readonly upstream?: UpstreamFixtures
  readonly retrieval?: Retrieval
  readonly clientDir?: string
  readonly scheduling?: PollSchedulerLimits
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
  readonly retrieval: Retrieval
  readonly settings: InstallationSettingsStore
  readonly database: DrizzleDatabase
  readonly logs: readonly LogRecord[]
  readonly sleeps: readonly number[]
  fetch(path: string, init?: RequestInit): Promise<Response>
  wakeScheduler(): Promise<void>
  restart(): Promise<void>
  stop(): Promise<void>
}

const running: BootedService[] = []

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

export function databasePathOf(harness: TestService): string {
  return join(harness.dataDir, DATABASE_FILE)
}
