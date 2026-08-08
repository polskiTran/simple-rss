import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test as base } from '@playwright/test'
import { loadConfig } from '../../src/server/config.js'
import { createLogger } from '../../src/server/logger.js'
import { startService, type RunningService } from '../../src/server/server.js'
import { createRetrieval } from '../../src/server/upstream/retrieval.js'
import { UpstreamFixtures } from '../support/upstream-fixtures.js'

export const SETUP_SECRET = 'a-deployment-setup-secret'
export const OWNER_PASSWORD = 'a-calm-reading-password'

export interface Installation {
  /** Origin the browser loads, e.g. `http://127.0.0.1:53124`. */
  readonly url: string
  /** Exact Feed URL served by the controllable publisher fixture. */
  readonly feedUrl: string
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
    const feedUrl = 'https://publisher.example/feed.xml'
    const upstream = new UpstreamFixtures().stub(feedUrl, {
      headers: { 'content-type': 'application/rss+xml' },
      body: `<?xml version="1.0"?>
        <rss version="2.0"><channel><title>Field Notes</title>
          <item><guid>one</guid><title>First light</title>
            <link>https://publisher.example/first-light</link>
            <pubDate>Fri, 08 Aug 2026 07:15:00 GMT</pubDate>
            <description>A clear morning.</description>
          </item>
        </channel></rss>`,
    })
    let service: RunningService | undefined

    try {
      const config = loadConfig({
        DATA_DIR: dataDir,
        SETUP_SECRET,
        PUBLIC_ORIGIN: 'https://reader.test',
        CLIENT_DIR: 'dist/client',
        LOG_LEVEL: 'warn',
      })
      const logger = createLogger({ level: 'warn' })
      service = await startService({
        config,
        port: 0,
        logger,
        retrieval: createRetrieval({
          httpClient: upstream.client,
          resolve: upstream.resolve,
          logger,
          self: new URL(config.publicOrigin),
        }),
      })
      await use({ url: service.url, feedUrl })
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
