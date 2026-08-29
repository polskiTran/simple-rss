import { existsSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { readinessSchema } from '../../src/shared/api.js'
import { claimedDevice } from '../support/device.js'
import { databasePathOf, startTestService } from '../support/service-harness.js'

const FEED_URL = 'https://journal.example/feed'
const ARTICLE_URL = 'https://journal.example/first-light'

const ARTICLE_HTML = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>First light</title></head>
  <body><main><article><h1>First light</h1>
  ${Array.from({ length: 12 }, (_, index) => `<p>Paragraph ${index} follows the light across the valley with a steady sentence, long enough to read as honest prose.</p>`).join('\n')}
  </article></main></body></html>`

const RSS = `<?xml version="1.0"?>
  <rss version="2.0"><channel><title>Field Notes</title><item>
    <guid>first-light</guid><title>first-light</title><link>${ARTICLE_URL}</link>
    <pubDate>${new Date(Date.UTC(2026, 7, 8, 7, 0)).toUTCString()}</pubDate>
    <description>A clear morning over the valley.</description>
  </item></channel></rss>`

describe('service lifecycle', () => {
  it('creates the database inside the configured data directory', async () => {
    const service = await startTestService()

    expect(existsSync(databasePathOf(service))).toBe(true)
    expect(service.config.databasePath).toBe(databasePathOf(service))
  })

  it('refuses connections once stopped', async () => {
    const service = await startTestService()
    const url = service.url

    await service.stop()

    await expect(fetch(`${url}/health/live`)).rejects.toThrow()
  })

  it('closes the database as part of stopping', async () => {
    const service = await startTestService()
    const db = service.database!

    await service.stop()

    expect(db.$client.open).toBe(false)
  })

  it('logs the shutdown sequence in order', async () => {
    const service = await startTestService()

    await service.stop()

    const lifecycle = service.logs
      .map((record) => record.message)
      .filter(
        (message) => message === 'server.started' || message === 'server.stopping' || message === 'server.stopped',
      )
    expect(lifecycle).toEqual(['server.started', 'server.stopping', 'server.stopped'])
  })

  it('treats a second stop as a no-op rather than an error', async () => {
    const service = await startTestService()

    await service.stop()

    await expect(service.stop()).resolves.toBeUndefined()
  })

  it('drains an established keep-alive connection instead of waiting out the grace period', async () => {
    const service = await startTestService({ env: { SHUTDOWN_GRACE_MS: '30000' } })
    await (await service.fetch('/api/meta')).text()

    const startedAt = Date.now()
    await service.stop()

    expect(Date.now() - startedAt).toBeLessThan(2_000)
    expect(service.logs.map((record) => record.message)).not.toContain('server.stop_forced')
  })

  it('lets a Reader extraction already in flight finish rather than aborting it', async () => {
    const service = await startTestService({ env: { SHUTDOWN_GRACE_MS: '30000' } })
    service.upstream.stub(FEED_URL, { headers: { 'content-type': 'application/rss+xml' }, body: RSS })
    const user = await claimedDevice(service)
    await user.post('/api/subscriptions', { url: FEED_URL })
    await service.wakeScheduler()
    const digest = (await (await user.get('/api/digest')).json()) as {
      groups: { items: { feedItemId: number }[] }[]
    }
    const feedItemId = digest.groups.flatMap((group) => group.items)[0]?.feedItemId
    service.upstream.stub(ARTICLE_URL, { headers: { 'content-type': 'text/html' }, body: ARTICLE_HTML, delayMs: 400 })

    const inFlight = user.get(`/api/items/${feedItemId}/reader`)
    await new Promise((resolve) => setTimeout(resolve, 120))
    const stopped = service.stop()

    expect((await inFlight).status).toBe(200)
    await stopped
  })

  it('closes readiness when the volume stops accepting writes', async () => {
    const service = await startTestService()
    service.database!.$client.exec('DROP TABLE write_probe')

    const response = await service.fetch('/health/ready')

    expect(response.status).toBe(503)
    expect(readinessSchema.parse(await response.json())).toEqual({
      status: 'unready',
      reason: 'database is not writable',
    })
  })
})
