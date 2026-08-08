import { join } from 'node:path'
import { afterEach } from 'vitest'
import { DATABASE_FILE, loadConfig, type Config } from '../../src/server/config.js'
import { createLogger, type LogRecord } from '../../src/server/logger.js'
import type { SqliteDatabase } from '../../src/server/persistence/database.js'
import type { InstallationSettingsStore } from '../../src/server/persistence/installation-settings.js'
import { startService, type RunningService } from '../../src/server/server.js'
import { ManualClock } from './manual-clock.js'
import { makeTempDataDir } from './temp-dir.js'
import { UpstreamFixtures } from './upstream-fixtures.js'

export interface HarnessOptions {
  /** Reuse an existing data directory, e.g. to model a container replacement. */
  readonly dataDir?: string
  /** Extra environment for `loadConfig`, so tests exercise real parsing. */
  readonly env?: Record<string, string>
  readonly clock?: ManualClock
  readonly upstream?: UpstreamFixtures
  /** Built client bundle to serve. Omitted means "no client on disk". */
  readonly clientDir?: string
}

export interface TestService {
  readonly url: string
  readonly config: Config
  readonly dataDir: string
  readonly clock: ManualClock
  readonly upstream: UpstreamFixtures
  readonly settings: InstallationSettingsStore | undefined
  /** The live connection, for assertions SQL states better than HTTP does. */
  readonly database: SqliteDatabase | undefined
  /** Every structured log record the service wrote. */
  readonly logs: readonly LogRecord[]
  /** Same-origin request against the running service; `path` starts with `/`. */
  fetch(path: string, init?: RequestInit): Promise<Response>
  /**
   * Stops the process and starts a new one on the same data directory —
   * the application-level shape of replacing a container.
   */
  restart(): Promise<void>
  stop(): Promise<void>
}

const running: RunningService[] = []

/**
 * Boots the complete service — real socket, real SQLite file in a temporary
 * directory, real migrations — with time and upstream HTTP under test control.
 *
 * This is the primary harness. Later tickets add Feed retrieval and polling
 * behind the same two seams, so their tests keep asserting on HTTP responses
 * and stored state rather than on internals.
 */
export async function startTestService(options: HarnessOptions = {}): Promise<TestService> {
  const dataDir = options.dataDir ?? (await makeTempDataDir())
  const clock = options.clock ?? new ManualClock()
  const upstream = options.upstream ?? new UpstreamFixtures()
  const logs: LogRecord[] = []

  const config = loadConfig({
    DATA_DIR: dataDir,
    LOG_LEVEL: 'debug',
    SHUTDOWN_GRACE_MS: '2000',
    ...(options.clientDir ? { CLIENT_DIR: options.clientDir } : {}),
    ...options.env,
  })

  // Every boot — the first and each restart — is wired identically, so a
  // restart really is the same service on the same volume.
  const boot = async () => {
    const started = await startService({
      config,
      port: 0,
      clock,
      httpClient: upstream.client,
      logger: createLogger({
        level: config.logLevel,
        now: () => clock.now(),
        sink: (record) => void logs.push(record),
      }),
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
    get settings() {
      return service.settings
    },
    get database() {
      return service.database
    },
    logs,
    fetch: (path, init) => fetch(new URL(path, service.url), init),
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

/** Any service a test forgot to stop, so one failure cannot hang the suite. */
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
