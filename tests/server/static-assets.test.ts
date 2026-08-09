import { describe, expect, it } from 'vitest'
import { startTestService } from '../support/service-harness.js'

const CLIENT = 'tests/fixtures/client'

describe('serving the built client', () => {
  it('serves index.html at the root', async () => {
    const service = await startTestService({ clientDir: CLIENT })

    const response = await service.fetch('/')

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toMatch(/text\/html/)
    expect(await response.text()).toContain('<div id="root">')
  })

  it('falls back to index.html so a client route survives a reload', async () => {
    const service = await startTestService({ clientDir: CLIENT })

    const response = await service.fetch('/settings')

    expect(response.status).toBe(200)
    expect(await response.text()).toContain('<div id="root">')
  })

  it('never lets the shell be cached, so a new build is picked up on reload', async () => {
    const service = await startTestService({ clientDir: CLIENT })

    const response = await service.fetch('/')

    expect(response.headers.get('cache-control')).toBe('no-cache')
  })

  it('serves content-hashed assets as immutable', async () => {
    const service = await startTestService({ clientDir: CLIENT })

    const response = await service.fetch('/assets/app-abc123.js')

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toMatch(/text\/javascript/)
    expect(response.headers.get('cache-control')).toBe('public, max-age=31536000, immutable')
    expect(await response.text()).toContain('built client')
  })

  it('serves other bundled files with their own content type', async () => {
    const service = await startTestService({ clientDir: CLIENT })

    const response = await service.fetch('/robots.txt')

    expect(response.headers.get('content-type')).toMatch(/text\/plain/)
    expect(response.headers.get('cache-control')).toBe('no-cache')
  })

  it('answers a missing bundle file with 404 rather than the shell', async () => {
    const service = await startTestService({ clientDir: CLIENT })

    const response = await service.fetch('/assets/app-deadbeef.js')

    expect(response.status).toBe(404)
    expect(response.headers.get('content-type')).toMatch(/application\/json/)
  })

  it.each([
    '/../../package.json',
    '/assets/../../../package.json',
    '/%2e%2e%2f%2e%2e%2fpackage.json',
    '/assets/..%2f..%2f..%2fpackage.json',
  ])('refuses to read %s from outside the bundle', async (path) => {
    const service = await startTestService({ clientDir: CLIENT })

    const response = await service.fetch(path)
    const body = await response.text()

    // Never the file itself: an escaping path is either a client route or,
    // under /assets, a missing bundle file.
    expect(body).not.toContain('"name": "simple-rss"')
    expect(body).not.toContain('"version"')
  })

  it('answers with JSON when no client bundle has been built', async () => {
    const service = await startTestService({ clientDir: 'tests/fixtures/no-such-client' })

    const response = await service.fetch('/')

    expect(response.status).toBe(404)
    expect(response.headers.get('content-type')).toMatch(/application\/json/)
  })
})
