import { loadConfig, type Config } from '../../src/server/config.js'
import type { Logger } from '../../src/server/logger.js'
import { startService, type RunningService, type ServiceOptions } from '../../src/server/service.js'
import { createRetrieval, type Retrieval } from '../../src/server/upstream/retrieval.js'
import type { UpstreamFixtures } from './upstream-fixtures.js'

export const SETUP_SECRET = 'a-deployment-setup-secret'

export const USER_PASSWORD = 'a-calm-reading-password'

export interface BootOptions extends Omit<ServiceOptions, 'config' | 'port' | 'retrieval' | 'logger'> {
  readonly dataDir: string
  readonly logger: Logger
  readonly env?: Readonly<Record<string, string>>
  readonly upstream: UpstreamFixtures
  readonly retrieval?: Retrieval | undefined
}

export interface BootedService extends RunningService {
  readonly config: Config
  readonly retrieval: Retrieval
}

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
      canonicalOrigin: new URL(config.publicOrigin),
      allowBenchmarkAddresses: config.reservedFetchMode === 'benchmark',
    })
  const service = await startService({ ...options, config, port: 0, retrieval: boundary })
  return { ...service, config, retrieval: boundary }
}
