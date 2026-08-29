import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test as base, type Page } from '@playwright/test'
import { loadConfig } from '../../src/server/config.js'
import { createLogger } from '../../src/server/logger.js'
import { startService, type RunningService } from '../../src/server/server.js'
import { createRetrieval } from '../../src/server/upstream/retrieval.js'
import { UpstreamFixtures } from '../support/upstream-fixtures.js'

export const SETUP_SECRET = 'a-deployment-setup-secret'
export const USER_PASSWORD = 'a-calm-reading-password'

export interface Installation {
  readonly url: string
  readonly feedUrl: string
  readonly brokenArticleFeedUrl: string
  /** Its article outlasts the Reader budget once, then answers instantly. */
  readonly slowArticleFeedUrl: string
  readonly longFeedUrl: string
}

const FIGURE_IMAGE_URL = 'https://cdn.publisher.example/image/fetch/$s_!9LbW!,w_424,c_limit,f_webp/valley.png'
const FIGURE_FULL_SIZE_URL =
  'https://cdn.publisher.example/image/fetch/$s_!9LbW!,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fpost-media.publisher.example%2Fpublic%2Fimages%2F22a60ecb-ebf1-4dad-b91f-6d2c864d8fe7_996x477.png'

const QUOTED_LONG_URL =
  'https://cdn.publisher.example/archive/2026/08/09/the-long-unbroken-address-a-publisher-quotes-in-running-prose-22a60ecb-ebf1-4dad-b91f-6d2c864d8fe7.html'

const PUBLISHED_MATH =
  '<span class="katex"><span class="katex-mathml"><math xmlns="http://www.w3.org/1998/Math/MathML"><semantics><mrow>' +
  '<msup><mi>e</mi><mrow><mi>i</mi><mi>π</mi></mrow></msup><mo>=</mo><mo>−</mo><mn>1</mn></mrow>' +
  '<annotation encoding="application/x-tex">e^{i\\pi} = -1</annotation></semantics></math></span>' +
  '<span class="katex-html" aria-hidden="true">e</span></span>'

const PUBLISHED_DISPLAY_MATH =
  '<span class="katex-display"><span class="katex"><span class="katex-mathml">' +
  '<math xmlns="http://www.w3.org/1998/Math/MathML" display="block"><semantics><mrow><mi>L</mi></mrow>' +
  '<annotation encoding="application/x-tex">' +
  "L'(N_{\\backslash E}, C_{\\backslash E}) = -\\alpha A(N_{\\backslash E} + \\omega N_{\\backslash E}^{1/3})^{-\\alpha-1}" +
  '(1 + \\frac{\\omega}{3} N_{\\backslash E}^{-2/3}) + \\beta B\\left(\\frac{C_{\\backslash E}}{6}\\right)^{-\\beta} ' +
  'N_{\\backslash E}^{\\beta-1} = 0 \\tag{18}' +
  '</annotation></semantics></math></span><span class="katex-html" aria-hidden="true">L</span></span></span>'

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
        <p>Run <code>observe()</code> before the light, and read <code>exposure</code> back.</p>
        <pre><code class="language-python">def observe():\n    # before the light\n\n    return light</code></pre>
        <table>
          <thead><tr><th>Hour</th><th>Reading</th></tr></thead>
          <tbody><tr><td>05:40</td><td>grey</td></tr><tr><td>06:10</td><td>gold</td></tr></tbody>
        </table>
        <blockquote><p>The light does not wait for the camera.</p></blockquote>
        <p>The exposure holds at ${PUBLISHED_MATH} from there.</p>
        ${PUBLISHED_DISPLAY_MATH}
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
  readonly url: string
  serve(html: string): void
}

export interface InstallationOptions {
  /** Shortens the server's Reader budget so a deadline test never waits out the production value. */
  readonly readerBudgetMs: number | undefined
}

export const test = base.extend<InstallationOptions & { installation: Installation; foreign: ForeignSite }>({
  readerBudgetMs: [undefined, { option: true }],

  installation: async ({ readerBudgetMs }, use) => {
    const dataDir = await mkdtemp(join(tmpdir(), 'simple-rss-browser-'))
    const feedUrl = 'https://publisher.example/feed.xml'
    const brokenArticleFeedUrl = 'https://publisher.example/coast.xml'
    const slowArticleFeedUrl = 'https://publisher.example/ridge.xml'
    const longFeedUrl = 'https://publisher.example/meadow.xml'
    const publishedAt = new Date()
    publishedAt.setUTCHours(7, 15, 0, 0)
    const publishedEarlier = new Date(publishedAt.getTime() - 24 * 60 * 60 * 1_000)
    const upstream = new UpstreamFixtures()
      .stub(feedUrl, {
        headers: { 'content-type': 'application/rss+xml' },
        body: `<?xml version="1.0"?>
          <rss version="2.0"><channel><title>Field Notes</title>
            <description>Notes from the field.</description>
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
        delayMs: 500,
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
      .stub(slowArticleFeedUrl, {
        headers: { 'content-type': 'application/rss+xml' },
        body: `<?xml version="1.0"?>
          <rss version="2.0"><channel><title>The High Ridge</title>
            <item><guid>ridge</guid><title>Slow ridge</title>
              <link>https://publisher.example/slow-ridge</link>
              <pubDate>${publishedEarlier.toUTCString()}</pubDate>
              <description>The ridge holds its light.</description>
            </item>
          </channel></rss>`,
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
    let ridgeAttempts = 0
    upstream.stubDynamic('https://publisher.example/slow-ridge', () => {
      ridgeAttempts += 1
      return ridgeAttempts === 1
        ? { headers: { 'content-type': 'text/html; charset=utf-8' }, body: ARTICLE_HTML, delayMs: 60_000 }
        : { headers: { 'content-type': 'text/html; charset=utf-8' }, body: ARTICLE_HTML }
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
        ...(readerBudgetMs === undefined ? {} : { readerBudgetMs }),
      })
      await use({ url: service.url, feedUrl, brokenArticleFeedUrl, slowArticleFeedUrl, longFeedUrl })
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
      // the same port, so this is genuinely somebody else's site.
      await use({
        url: `http://localhost:${port}`,
        serve: (html) => {
          body = html
        },
      })
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  },
})

export { expect } from '@playwright/test'

export async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.body.clientWidth)
  expect(overflow).toBeLessThanOrEqual(0)
}

function listen(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })
}
