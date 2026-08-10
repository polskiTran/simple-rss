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
export const USER_PASSWORD = 'a-calm-reading-password'

export interface Installation {
  /** Origin the browser loads, e.g. `http://127.0.0.1:53124`. */
  readonly url: string
  /** Exact Feed URL served by the controllable publisher fixture. */
  readonly feedUrl: string
  /** A second Feed whose one item's original page always answers 500. */
  readonly brokenArticleFeedUrl: string
  /** A Feed of 55 items — more than one Digest page, so the list ends early. */
  readonly longFeedUrl: string
}

/**
 * The original page behind `First light`. Long enough to extract as a real
 * article, structured enough to prove the Reader keeps structure, and armed
 * enough — script, iframe, form, event handler — to prove sanitization in a
 * real browser rather than only in jsdom.
 */
/**
 * A figure linking to its own full-size copy, the way every newsletter
 * platform emits one.
 */
const FIGURE_IMAGE_URL = 'https://cdn.publisher.example/image/fetch/$s_!9LbW!,w_424,c_limit,f_webp/valley.png'
const FIGURE_FULL_SIZE_URL =
  'https://cdn.publisher.example/image/fetch/$s_!9LbW!,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fpost-media.publisher.example%2Fpublic%2Fimages%2F22a60ecb-ebf1-4dad-b91f-6d2c864d8fe7_996x477.png'

/**
 * An address quoted in the prose, with no space in it anywhere: the shape
 * that used to push the whole reading column past the edge of a phone.
 */
const QUOTED_LONG_URL =
  'https://cdn.publisher.example/archive/2026/08/09/the-long-unbroken-address-a-publisher-quotes-in-running-prose-22a60ecb-ebf1-4dad-b91f-6d2c864d8fe7.html'

/** A 1×1 PNG — enough to pass the proxy's magic-byte sniff and paint. */
const PNG_PIXEL = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)

const ARTICLE_HTML = `<!doctype html>
  <html lang="en">
    <head><meta charset="utf-8"><title>First light</title></head>
    <body>
      <nav><a href="/">Home</a><a href="/archive">Archive</a></nav>
      <main><article>
        <h1>First light</h1>
        ${Array.from(
          { length: 24 },
          (_, index) =>
            `<p>Paragraph ${index} follows the light across the valley floor with a steady sentence, long enough to be honest reading rather than filler.</p>`,
        ).join('\n')}
        <h2>Field methods</h2>
        <ul><li>arrive before the light</li><li>write down what is actually there</li></ul>
        <pre><code class="language-python">def observe():\n    return light</code></pre>
        <p>The full notes live in <a href="/notes">the notebook</a>.</p>
        <figure><a href="${FIGURE_FULL_SIZE_URL}"><img src="${FIGURE_IMAGE_URL}" alt="the valley at dawn"></a><figcaption>Dawn from the ridge.</figcaption></figure>
        <p>The plate above was filed at ${QUOTED_LONG_URL} on the morning it was made.</p>
        <script>document.body.innerHTML = 'a hostile page took over'</script>
        <iframe src="https://tracker.example/pixel"></iframe>
        <form action="/subscribe"><button>Subscribe now</button></form>
        <p onmouseover="alert(1)">A final calm paragraph.</p>
      </article></main>
    </body>
  </html>`

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
    const brokenArticleFeedUrl = 'https://publisher.example/coast.xml'
    const longFeedUrl = 'https://publisher.example/meadow.xml'
    // Today at 07:15 UTC, so the item lands in the Digest's "today" group on
    // any run date (chronology tolerates a publication up to a day ahead).
    const publishedAt = new Date()
    publishedAt.setUTCHours(7, 15, 0, 0)
    // The second Feed's item is older, so `next in the digest` is stable.
    const publishedEarlier = new Date(publishedAt.getTime() - 24 * 60 * 60 * 1_000)
    const upstream = new UpstreamFixtures()
      .stub(feedUrl, {
        headers: { 'content-type': 'application/rss+xml' },
        body: `<?xml version="1.0"?>
          <rss version="2.0"><channel><title>Field Notes</title>
            <item><guid>one</guid><title>First light</title>
              <link>https://publisher.example/first-light</link>
              <pubDate>${publishedAt.toUTCString()}</pubDate>
              <description>A clear morning.</description>
            </item>
          </channel></rss>`,
      })
      .stub('https://publisher.example/first-light', {
        headers: { 'content-type': 'text/html; charset=utf-8' },
        body: ARTICLE_HTML,
      })
      .stub(FIGURE_IMAGE_URL, {
        headers: { 'content-type': 'image/png' },
        body: PNG_PIXEL,
      })
      .stub(brokenArticleFeedUrl, {
        headers: { 'content-type': 'application/rss+xml' },
        body: `<?xml version="1.0"?>
          <rss version="2.0"><channel><title>The Quiet Coast</title>
            <item><guid>tide</guid><title>Slow water</title>
              <link>https://publisher.example/slow-water</link>
              <pubDate>${publishedEarlier.toUTCString()}</pubDate>
              <description>Tide notes from the shore.</description>
            </item>
          </channel></rss>`,
      })
      .stub('https://publisher.example/slow-water', {
        status: 500,
        headers: { 'content-type': 'text/html' },
        body: 'the shore is closed',
      })
      .stub(longFeedUrl, {
        headers: { 'content-type': 'application/rss+xml' },
        body: `<?xml version="1.0"?>
          <rss version="2.0"><channel><title>Long Meadow</title>
            ${Array.from(
              { length: 55 },
              (_, index) => `<item><guid>meadow-${index}</guid><title>Meadow note ${index}</title>
                <link>https://publisher.example/meadow-${index}</link>
                <pubDate>${new Date(publishedAt.getTime() - (index + 1) * 60_000).toUTCString()}</pubDate>
              </item>`,
            ).join('\n')}
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
      await use({ url: service.url, feedUrl, brokenArticleFeedUrl, longFeedUrl })
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
