import { describe, expect, it } from 'vitest'
import { claimedDevice } from '../support/device.js'
import { startTestService } from '../support/service-harness.js'

const FEED_URL = 'https://journal.example/feed'

const rss = (description: string | null) => `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Field Notes</title>
    <link>https://journal.example/</link>
    ${description === null ? '' : `<description>${description}</description>`}
    <item>
      <guid>entry-1</guid>
      <title>First light</title>
      <pubDate>Fri, 08 Aug 2026 07:15:00 GMT</pubDate>
    </item>
  </channel>
</rss>`

describe('Custom Description', () => {
  it('shows in place of the Feed Description on list and detail, and clearing it reveals the refreshed one', async () => {
    const service = await startTestService()
    service.upstream.stub(FEED_URL, {
      headers: { 'content-type': 'application/rss+xml' },
      body: rss('Notes from the field'),
    })
    const user = await claimedDevice(service)
    expect((await user.post('/api/subscriptions', { url: FEED_URL })).status).toBe(201)
    await service.wakeScheduler()

    const updated = await user.put('/api/feeds/1/details', { customTitle: null, customDescription: 'read weekly' })
    expect(updated.status).toBe(200)
    expect(await updated.json()).toEqual({
      title: 'Field Notes',
      customTitle: null,
      description: 'read weekly',
      customDescription: 'read weekly',
    })

    const feeds = await (await user.get('/api/feeds')).json()
    expect(feeds.subscriptions[0]).toMatchObject({ description: 'read weekly' })
    const detail = await (await user.get('/api/feeds/1')).json()
    expect(detail).toMatchObject({
      description: 'read weekly',
      reportedDescription: 'Notes from the field',
      customDescription: 'read weekly',
    })

    // The override outlives a poll that refreshes what the Feed reports.
    service.upstream.stub(FEED_URL, {
      headers: { 'content-type': 'application/rss+xml' },
      body: rss('New words from the publisher'),
    })
    service.clock.advance(3 * 60 * 60 * 1_000)
    await service.wakeScheduler()
    expect((await (await user.get('/api/feeds/1')).json()).description).toBe('read weekly')

    const cleared = await user.put('/api/feeds/1/details', { customTitle: null, customDescription: null })
    expect(cleared.status).toBe(200)
    expect(await cleared.json()).toEqual({
      title: 'Field Notes',
      customTitle: null,
      description: 'New words from the publisher',
      customDescription: null,
    })
  })

  it('stands alone when the Feed reports no description, and clearing returns to none', async () => {
    const service = await startTestService()
    service.upstream.stub(FEED_URL, { headers: { 'content-type': 'application/rss+xml' }, body: rss(null) })
    const user = await claimedDevice(service)
    expect((await user.post('/api/subscriptions', { url: FEED_URL })).status).toBe(201)
    await service.wakeScheduler()

    expect(
      (await user.put('/api/feeds/1/details', { customTitle: null, customDescription: 'woodworking' })).status,
    ).toBe(200)
    expect(await (await user.get('/api/feeds/1')).json()).toMatchObject({
      description: 'woodworking',
      reportedDescription: null,
    })

    expect((await user.put('/api/feeds/1/details', { customTitle: null, customDescription: null })).status).toBe(200)
    expect(await (await user.get('/api/feeds/1')).json()).toMatchObject({
      description: null,
      customDescription: null,
    })
  })

  it('refuses blank and oversized descriptions and a body missing the field', async () => {
    const service = await startTestService()
    const user = await claimedDevice(service)
    expect((await user.post('/api/subscriptions', { url: FEED_URL })).status).toBe(201)

    expect((await user.put('/api/feeds/1/details', { customTitle: null, customDescription: '' })).status).toBe(400)
    expect((await user.put('/api/feeds/1/details', { customTitle: null, customDescription: '   ' })).status).toBe(400)
    expect(
      (await user.put('/api/feeds/1/details', { customTitle: null, customDescription: 'a'.repeat(1025) })).status,
    ).toBe(400)
    expect((await user.put('/api/feeds/1/details', { customTitle: null })).status).toBe(400)

    const detail = await (await user.get('/api/feeds/1')).json()
    expect(detail).toMatchObject({ description: null, customDescription: null })
  })

  it('carries the effective description into OPML export, and dies with the Subscription', async () => {
    const service = await startTestService()
    service.upstream.stub(FEED_URL, {
      headers: { 'content-type': 'application/rss+xml' },
      body: rss('Notes from the field'),
    })
    const user = await claimedDevice(service)
    expect((await user.post('/api/subscriptions', { url: FEED_URL })).status).toBe(201)
    await service.wakeScheduler()
    expect(
      (await user.put('/api/feeds/1/details', { customTitle: null, customDescription: 'read weekly' })).status,
    ).toBe(200)

    const opml = await (await user.get('/api/subscriptions/export')).text()
    expect(opml).toContain('description="read weekly"')
    expect(opml).not.toContain('Notes from the field')

    expect((await user.delete('/api/feeds/1')).status).toBe(204)
    expect((await user.post('/api/subscriptions', { url: FEED_URL })).status).toBe(201)
    expect(await (await user.get('/api/feeds/1')).json()).toMatchObject({
      description: 'Notes from the field',
      customDescription: null,
    })
  })
})
