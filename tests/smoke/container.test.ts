import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { apiErrorSchema, readinessSchema, serviceMetaSchema } from '../../src/shared/api.js'
import { VERSION } from '../../src/shared/version.js'
import { buildImage, docker, logRecords, startContainer, uniqueName, type Container } from './docker.js'

/**
 * The production image, exercised the way a platform runs it: an injected
 * port, a volume at `/app/data`, stdout logs, and SIGTERM to stop.
 *
 * These run under `pnpm test:smoke` rather than `pnpm test` because they build
 * an image; the in-process suite covers the same behaviour far faster.
 */

const started: Container[] = []
const volumes: string[] = []

/** Stops and deletes a container, taking it out of the cleanup list. */
async function retire(container: Container): Promise<void> {
  await container.stop()
  await container.remove()
  const index = started.indexOf(container)
  if (index >= 0) started.splice(index, 1)
}

async function start(options: { volume?: string; env?: Record<string, string>; port?: number } = {}) {
  const volume = options.volume ?? uniqueName('simple-rss-data')
  if (!options.volume) volumes.push(volume)

  const container = await startContainer({
    volume,
    ...(options.env ? { env: options.env } : {}),
    ...(options.port ? { port: options.port } : {}),
  })
  started.push(container)
  return { container, volume }
}

beforeAll(async () => {
  await buildImage()
}, 900_000)

afterEach(async () => {
  await Promise.all(started.splice(0, started.length).map((container) => container.remove()))
})

afterAll(async () => {
  await Promise.all(volumes.splice(0, volumes.length).map((volume) => docker(['volume', 'rm', '-f', volume])))
})

describe('the production image', () => {
  it('migrates the mounted volume during startup', async () => {
    const { container } = await start()

    const records = logRecords(await container.logs())
    const migrated = records.find((record) => record.message === 'startup.migrations_applied')

    expect(migrated).toMatchObject({ databasePath: '/app/data/simple-rss.db', applied: [1] })
  })

  it('reports liveness and readiness', async () => {
    const { container } = await start()

    const live = await container.fetch('/health/live')
    const ready = await container.fetch('/health/ready')

    expect(live.status).toBe(200)
    expect(ready.status).toBe(200)
    expect(readinessSchema.parse(await ready.json())).toEqual({ status: 'ready' })
  })

  it('accepts the port the platform injects', async () => {
    const { container } = await start({ env: { PORT: '9111' }, port: 9111 })

    expect((await container.fetch('/health/live')).status).toBe(200)
  })

  it('writes structured logs to stdout', async () => {
    const { container } = await start()

    const records = logRecords(await container.logs())

    expect(records.length).toBeGreaterThan(0)
    expect(records.every((record) => typeof record.level === 'string' && typeof record.time === 'string')).toBe(true)
  })

  it('serves the built client', async () => {
    const { container } = await start()

    const response = await container.fetch('/')
    const html = await response.text()

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toMatch(/text\/html/)
    expect(html).toContain('<div id="root">')
  })

  it('serves the client bundle it references, cached as immutable', async () => {
    const { container } = await start()
    const html = await (await container.fetch('/')).text()
    const asset = /src="(\/assets\/[^"]+\.js)"/.exec(html)?.[1]

    expect(asset).toBeDefined()
    const response = await container.fetch(asset!)

    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('public, max-age=31536000, immutable')
  })

  it('falls back to the client shell for a client route', async () => {
    const { container } = await start()

    const response = await container.fetch('/settings')

    expect(response.status).toBe(200)
    expect(await response.text()).toContain('<div id="root">')
  })

  it('answers the API boundary with JSON', async () => {
    const { container } = await start()

    const meta = await container.fetch('/api/meta')
    const unknown = await container.fetch('/api/does-not-exist')

    expect(serviceMetaSchema.parse(await meta.json())).toEqual({ name: 'simple-rss', version: VERSION })
    expect(unknown.status).toBe(404)
    expect(apiErrorSchema.parse(await unknown.json()).error.code).toBe('not_found')
  })

  it('sends the restrictive content security policy', async () => {
    const { container } = await start()

    const policy = (await container.fetch('/')).headers.get('content-security-policy') ?? ''

    expect(policy).toContain("default-src 'self'")
    expect(policy).toContain("frame-ancestors 'none'")
  })

  it('ships no service worker or install manifest', async () => {
    const { container } = await start()

    const listing = await container.exec(['sh', '-c', 'ls -R /app/dist/client'])

    expect(listing.stdout).not.toMatch(/service-?worker|\bsw\.js\b|manifest\.(webmanifest|json)/i)
  })

  it('runs as an unprivileged user', async () => {
    const { container } = await start()

    const whoami = await container.exec(['whoami'])

    expect(whoami.stdout.trim()).toBe('node')
  })

  it('stops gracefully on SIGTERM rather than being killed', async () => {
    const { container } = await start()

    const { durationMs, exitCode } = await container.stop(30)

    // 137 would mean the platform had to SIGKILL it after the timeout.
    expect(exitCode).toBe(0)
    expect(durationMs).toBeLessThan(15_000)
    expect(logRecords(await container.logs()).map((record) => record.message)).toContain('server.stopped')
  })
})

describe('replacing the container', () => {
  it('preserves a seeded installation setting on the retained volume', async () => {
    const first = await start()
    await first.container.exec(['node', 'dist/server/cli-main.js', 'set-timezone', 'Europe/Berlin'])

    await retire(first.container)
    const second = await start({ volume: first.volume })

    const shown = await second.container.exec(['node', 'dist/server/cli-main.js', 'show'])
    expect(JSON.parse(shown.stdout).timezone).toBe('Europe/Berlin')
  })

  it('applies no migrations the second time', async () => {
    const first = await start()
    await retire(first.container)

    const second = await start({ volume: first.volume })

    const migrated = logRecords(await second.container.logs()).find(
      (record) => record.message === 'startup.migrations_applied',
    )
    expect(migrated).toMatchObject({ applied: [] })
  })

  it('comes back ready on the retained volume', async () => {
    const first = await start()
    await retire(first.container)

    const second = await start({ volume: first.volume })

    expect((await second.container.fetch('/health/ready')).status).toBe(200)
  })

  it('starts empty on a fresh volume', async () => {
    const { container } = await start()

    const shown = await container.exec(['node', 'dist/server/cli-main.js', 'show'])

    expect(shown.stdout.trim()).toBe('null')
  })
})
