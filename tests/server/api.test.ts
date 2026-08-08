import { describe, expect, it } from 'vitest'
import { apiErrorSchema, serviceMetaSchema } from '../../src/shared/api.js'
import { VERSION } from '../../src/shared/version.js'
import { startTestService } from '../support/service-harness.js'

describe('API boundary', () => {
  it('reports which build is running', async () => {
    const service = await startTestService()

    const response = await service.fetch('/api/meta')

    expect(response.status).toBe(200)
    expect(serviceMetaSchema.parse(await response.json())).toEqual({ name: 'simple-rss', version: VERSION })
  })

  it('answers an unknown API route with JSON, never the client bundle', async () => {
    const service = await startTestService({ clientDir: 'tests/fixtures/client' })

    const response = await service.fetch('/api/does-not-exist')

    expect(response.status).toBe(404)
    expect(response.headers.get('content-type')).toMatch(/application\/json/)
    expect(apiErrorSchema.parse(await response.json()).error.code).toBe('not_found')
  })

  it('answers an unknown API route the same way for every method', async () => {
    const service = await startTestService({ clientDir: 'tests/fixtures/client' })

    const response = await service.fetch('/api/subscriptions', { method: 'POST' })

    expect(response.status).toBe(404)
    expect(response.headers.get('content-type')).toMatch(/application\/json/)
  })

  it('sends the restrictive content security policy on every response', async () => {
    const service = await startTestService()

    const response = await service.fetch('/api/meta')
    const policy = response.headers.get('content-security-policy') ?? ''

    expect(policy).toContain("default-src 'self'")
    expect(policy).toContain("img-src 'self' data:")
    expect(policy).toContain("frame-ancestors 'none'")
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
    expect(response.headers.get('referrer-policy')).toBe('no-referrer')
  })

  it('logs the path of a completed request without its query string', async () => {
    const service = await startTestService()

    await service.fetch('/api/meta?q=something-private')

    const record = service.logs.find((entry) => entry.message === 'request.completed' && entry.status === 200)
    expect(record?.path).toBe('/api/meta')
    expect(JSON.stringify(record)).not.toContain('something-private')
  })
})
