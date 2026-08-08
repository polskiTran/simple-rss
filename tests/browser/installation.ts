import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test as base } from '@playwright/test'
import { loadConfig } from '../../src/server/config.js'
import { createLogger } from '../../src/server/logger.js'
import { startService, type RunningService } from '../../src/server/server.js'

export const SETUP_SECRET = 'a-deployment-setup-secret'
export const OWNER_PASSWORD = 'a-calm-reading-password'

export interface Installation {
  /** Origin the browser loads, e.g. `http://127.0.0.1:53124`. */
  readonly url: string
}

export interface ForeignSite {
  /** A different origin, for proving what a foreign page cannot do. */
  readonly url: string
  /** Serves `html` at `/`, with the installation's origin substituted in. */
  serve(html: string): void
}

/**
 * A whole installation on a real socket with its own empty volume, and a
 * second origin next to it.
 *
 * The service is the same `startService` the container runs, so these flows
 * exercise production wiring rather than a browser-shaped mock.
 */
export const test = base.extend<{ installation: Installation; foreign: ForeignSite }>({
  installation: async ({}, use) => {
    const dataDir = await mkdtemp(join(tmpdir(), 'simple-rss-browser-'))
    let service: RunningService | undefined

    try {
      service = await startService({
        config: loadConfig({
          DATA_DIR: dataDir,
          SETUP_SECRET,
          PUBLIC_ORIGIN: 'https://reader.test',
          CLIENT_DIR: 'dist/client',
          LOG_LEVEL: 'warn',
        }),
        port: 0,
        logger: createLogger({ level: 'warn' }),
      })
      await use({ url: service.url })
    } finally {
      await service?.stop()
      await rm(dataDir, { recursive: true, force: true })
    }
  },

  foreign: async ({}, use) => {
    let body = ''
    const server = createServer((_request, response) => {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      response.end(body)
    })

    await listen(server)
    const { port } = server.address() as AddressInfo

    try {
      // `localhost` and `127.0.0.1` are different origins to a browser even on
      // the same port, and different ports are different origins regardless —
      // either way this is genuinely somebody else's site.
      await use({ url: `http://localhost:${port}`, serve: (html) => void (body = html) })
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  },
})

export { expect } from '@playwright/test'

function listen(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })
}
