import { loadConfig, type Config } from '../../src/server/config.js'
import type { Logger } from '../../src/server/logger.js'
import { startService, type RunningService, type ServiceOptions } from '../../src/server/service.js'
import { createRetrieval, type Retrieval } from '../../src/server/upstream/retrieval.js'
import type { UpstreamFixtures } from './upstream-fixtures.js'

/** The Setup Secret every test installation is deployed with. */
export const SETUP_SECRET = 'a-deployment-setup-secret'

/** The password tests claim an installation with. */
export const USER_PASSWORD = 'a-calm-reading-password'

export interface BootOptions extends Omit<ServiceOptions, 'config' | 'port' | 'retrieval' | 'logger'> {
  readonly dataDir: string
  readonly logger: Logger
  /** Environment for `loadConfig`, layered over the test installation's own, so tests exercise real parsing. */
  readonly env?: Readonly<Record<string, string>>
  /** Answers every outbound request the hardened boundary lets through. */
  readonly upstream: UpstreamFixtures
  /** Replaces the boundary over `upstream`, for a test that scripts Retrieval's answers itself. */
  readonly retrieval?: Retrieval | undefined
}

export interface BootedService extends RunningService {
  readonly config: Config
  /** The outbound boundary the service was wired with. */
  readonly retrieval: Retrieval
}

/**
 * Boots the complete service on a free port — real socket, real SQLite in
 * `dataDir`, real migrations — with upstream HTTP answered by fixtures.
 * Framework-free: the vitest harness and the Playwright installation both
 * wrap it, and each owns its own teardown.
 */
export async function bootService({
  dataDir,
  env,
  upstream,
  retrieval,
  ...options
}: BootOptions): Promise<BootedService> {
  const config = loadConfig({ DATA_DIR: dataDir, SETUP_SECRET, PUBLIC_ORIGIN: 'https://reader.test', ...env })
  const boundary =
    retrieval ??
    createRetrieval({
      httpClient: upstream.client,
      resolve: upstream.resolve,
      logger: options.logger,
      self: new URL(config.publicOrigin),
    })
  const service = await startService({ ...options, config, port: 0, retrieval: boundary })
  return { ...service, config, retrieval: boundary }
}
