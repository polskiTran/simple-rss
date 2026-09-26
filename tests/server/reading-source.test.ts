import { describe, expect, it } from 'vitest'
import { claimedDevice } from '../support/device.js'
import { startTestService } from '../support/service-harness.js'

const FEED_URL = 'https://journal.example/feed'
const ITEM_URL = 'https://journal.example/first-light'
const RSS = `<?xml version="1.0"?>
  <rss version="2.0"><channel><title>Field Notes</title>
    <item><guid>first-light</guid><title>First light</title><link>${ITEM_URL}</link>
      <description><![CDATA[<p>A short body.</p>]]></description>
    </item>
  </channel></rss>`

describe('Subscription reading source', () => {
  it('defaults to Original webpage and persists a server-authoritative preference across restart', async () => {
    const service = await startTestService()
    service.upstream.stub(FEED_URL, { headers: { 'content-type': 'application/rss+xml' }, body: RSS })
    const user = await claimedDevice(service)

    const created = await user.post('/api/subscriptions', { url: FEED_URL })
    expect(await created.json()).toMatchObject({ subscription: { readingSource: 'original-webpage' } })
    await service.wakeScheduler()

    const changed = await user.put('/api/feeds/1/reading-source', { readingSource: 'feed-content' })
    expect(changed.status).toBe(200)
    expect(await changed.json()).toEqual({ readingSource: 'feed-content' })
    expect((await (await user.get('/api/feeds')).json()).subscriptions[0].readingSource).toBe('feed-content')

    const detail = await (await user.get('/api/feeds/1')).json()
    expect(detail.readingSource).toBe('feed-content')
    const item = await (await user.get(`/api/items/${detail.items[0].feedItemId}`)).json()
    expect(item.readingSource).toBe('feed-content')

    await service.restart()
    expect((await (await user.get('/api/feeds/1')).json()).readingSource).toBe('feed-content')
  })

  it('validates updates and view-only source requests never mutate the preference', async () => {
    const service = await startTestService()
    service.upstream
      .stub(FEED_URL, { headers: { 'content-type': 'application/rss+xml' }, body: RSS })
      .stub(ITEM_URL, { headers: { 'content-type': 'text/html' }, body: '<main><p>Original body.</p></main>' })
    const user = await claimedDevice(service)
    await user.post('/api/subscriptions', { url: FEED_URL })
    await service.wakeScheduler()

    expect((await user.put('/api/feeds/1/reading-source', { readingSource: 'automatic' })).status).toBe(400)
    expect((await user.put('/api/feeds/99/reading-source', { readingSource: 'feed-content' })).status).toBe(404)
    expect((await user.put('/api/feeds/1/reading-source', { readingSource: 'feed-content' })).status).toBe(200)

    const detail = await (await user.get('/api/feeds/1')).json()
    const feedItemId = detail.items[0].feedItemId
    expect((await user.get(`/api/items/${feedItemId}`)).status).toBe(200)
    expect((await user.get(`/api/items/${feedItemId}/reader`)).status).toBe(200)
    expect(service.upstream.requestsTo(ITEM_URL)).toHaveLength(1)
    expect((await (await user.get('/api/feeds/1')).json()).readingSource).toBe('feed-content')
  })

  it('extracts when Feed Content is missing and keeps Feed Content when extraction fails', async () => {
    const BARE_URL = 'https://journal.example/bare'
    const service = await startTestService()
    service.upstream
      .stub(FEED_URL, {
        headers: { 'content-type': 'application/rss+xml' },
        body: RSS.replace('<item>', `<item><guid>bare</guid><title>Bare</title><link>${BARE_URL}</link></item><item>`),
      })
      .stub(BARE_URL, { headers: { 'content-type': 'text/html' }, body: '<main><p>Original body.</p></main>' })
      .stub(ITEM_URL, { status: 500, headers: { 'content-type': 'text/html' }, body: 'unavailable' })
    const user = await claimedDevice(service)
    await user.post('/api/subscriptions', { url: FEED_URL })
    await service.wakeScheduler()
    await user.put('/api/feeds/1/reading-source', { readingSource: 'feed-content' })
    const { items } = await (await user.get('/api/feeds/1')).json()
    const idOf = (title: string) => items.find((item: { title: string }) => item.title === title).feedItemId

    const bare = idOf('Bare')
    expect((await (await user.get(`/api/items/${bare}`)).json()).feedContent).toBeNull()
    expect((await user.get(`/api/items/${bare}/reader`)).status).toBe(200)
    expect(service.upstream.requestsTo(BARE_URL)).toHaveLength(1)

    const rich = idOf('First light')
    expect((await user.get(`/api/items/${rich}/reader`)).ok).toBe(false)
    expect(service.upstream.requestsTo(ITEM_URL)).toHaveLength(1)
    expect((await (await user.get(`/api/items/${rich}`)).json()).feedContent.markdown).toBe('A short body.')
  })
})
