import { describe, expect, it } from 'vitest'
import { startTestService } from '../support/service-harness.js'
import { ManualClock } from '../support/manual-clock.js'
import { UpstreamFixtures } from '../support/upstream-fixtures.js'

describe('the test harness', () => {
  it('drives the time the service records', async () => {
    const clock = new ManualClock('2026-08-08T09:00:00.000Z')
    const service = await startTestService({ clock })

    service.settings?.setTimezone('Europe/Berlin', service.clock.now())
    clock.advance(36 * 60 * 60 * 1000)
    service.settings?.setTimezone('Asia/Ho_Chi_Minh', service.clock.now())

    expect(service.settings?.read()).toMatchObject({
      createdAt: '2026-08-08T09:00:00.000Z',
      updatedAt: '2026-08-09T21:00:00.000Z',
    })
  })

  it('stamps log records with the controlled clock', async () => {
    const clock = new ManualClock('2026-08-08T09:00:00.000Z')
    const service = await startTestService({ clock })

    expect(service.logs[0]?.time).toBe('2026-08-08T09:00:00.000Z')
  })

  it('serves upstream responses from fixtures', async () => {
    const upstream = new UpstreamFixtures().stub('https://example.com/feed.xml', {
      headers: { 'content-type': 'application/rss+xml' },
      body: '<rss></rss>',
    })
    const service = await startTestService({ upstream })

    const response = await service.upstream.client(new Request('https://example.com/feed.xml'))

    expect(await response.text()).toBe('<rss></rss>')
    expect(service.upstream.requestsTo('https://example.com/feed.xml')).toHaveLength(1)
  })

  it('refuses to reach the network for an unstubbed upstream URL', async () => {
    const service = await startTestService()

    await expect(service.upstream.client(new Request('https://example.com/feed.xml'))).rejects.toThrow(
      /No upstream fixture/,
    )
  })

  it('lets a fixture change between calls, the way a Feed does', async () => {
    let calls = 0
    const upstream = new UpstreamFixtures().stubDynamic('https://example.com/feed.xml', () => ({
      body: `<rss>${(calls += 1)}</rss>`,
    }))
    const service = await startTestService({ upstream })

    const first = await service.upstream.client(new Request('https://example.com/feed.xml'))
    const second = await service.upstream.client(new Request('https://example.com/feed.xml'))

    expect(await first.text()).toBe('<rss>1</rss>')
    expect(await second.text()).toBe('<rss>2</rss>')
  })

  it('gives each service its own data directory', async () => {
    const first = await startTestService()
    const second = await startTestService()

    expect(first.dataDir).not.toBe(second.dataDir)
  })
})
