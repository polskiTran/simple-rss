import { describe, expect, it } from 'vitest'
import { claimedDevice } from '../support/device.js'
import { startTestService } from '../support/service-harness.js'

const FEED_URL = 'https://journal.example/feed'

const rss = (feedTitle: string) => `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>${feedTitle}</title>
    <link>https://journal.example/</link>
    <item>
      <guid>entry-1</guid>
      <title>First light</title>
      <link>https://journal.example/first-light</link>
      <pubDate>Fri, 08 Aug 2026 07:15:00 GMT</pubDate>
    </item>
  </channel>
</rss>`

describe('Custom Title', () => {
  it('names the Feed in the list and detail once set, with the reported title still visible in detail', async () => {
    const service = await startTestService()
    service.upstream.stub(FEED_URL, { headers: { 'content-type': 'application/rss+xml' }, body: rss('Field Notes') })
    const user = await claimedDevice(service)
    expect((await user.post('/api/subscriptions', { url: FEED_URL })).status).toBe(201)
    await service.wakeScheduler()

    const updated = await user.put('/api/feeds/1/details', { customTitle: 'Tech tabloid' })
    expect(updated.status).toBe(200)
    expect(await updated.json()).toEqual({ title: 'Tech tabloid', customTitle: 'Tech tabloid' })

    const feeds = await (await user.get('/api/feeds')).json()
    expect(feeds.subscriptions[0]).toMatchObject({ title: 'Tech tabloid' })

    const detail = await (await user.get('/api/feeds/1')).json()
    expect(detail).toMatchObject({
      title: 'Tech tabloid',
      reportedTitle: 'Field Notes',
      customTitle: 'Tech tabloid',
    })
  })

  it('survives every poll, and clearing it reveals the reported title the Feed moved to meanwhile', async () => {
    const service = await startTestService()
    service.upstream.stub(FEED_URL, { headers: { 'content-type': 'application/rss+xml' }, body: rss('Field Notes') })
    const user = await claimedDevice(service)
    expect((await user.post('/api/subscriptions', { url: FEED_URL })).status).toBe(201)
    await service.wakeScheduler()
    expect((await user.put('/api/feeds/1/details', { customTitle: 'Tech tabloid' })).status).toBe(200)

    service.upstream.stub(FEED_URL, {
      headers: { 'content-type': 'application/rss+xml' },
      body: rss('Field Notes, renamed'),
    })
    service.clock.advance(3 * 60 * 60 * 1_000)
    await service.wakeScheduler()

    const feeds = await (await user.get('/api/feeds')).json()
    expect(feeds.subscriptions[0]).toMatchObject({ title: 'Tech tabloid' })

    const cleared = await user.put('/api/feeds/1/details', { customTitle: null })
    expect(cleared.status).toBe(200)
    expect(await cleared.json()).toEqual({ title: 'Field Notes, renamed', customTitle: null })
    const detail = await (await user.get('/api/feeds/1')).json()
    expect(detail).toMatchObject({
      title: 'Field Notes, renamed',
      reportedTitle: 'Field Notes, renamed',
      customTitle: null,
    })
  })

  it('takes a Custom Title on an unchecked Feed; the first retrieval fills the reported title underneath', async () => {
    const service = await startTestService()
    service.upstream.stub(FEED_URL, { headers: { 'content-type': 'application/rss+xml' }, body: rss('Field Notes') })
    const user = await claimedDevice(service)
    expect((await user.post('/api/subscriptions', { url: FEED_URL })).status).toBe(201)

    const updated = await user.put('/api/feeds/1/details', { customTitle: 'My reading' })
    expect(updated.status).toBe(200)
    expect(await updated.json()).toEqual({ title: 'My reading', customTitle: 'My reading' })

    await service.wakeScheduler()
    const detail = await (await user.get('/api/feeds/1')).json()
    expect(detail).toMatchObject({ title: 'My reading', reportedTitle: 'Field Notes', customTitle: 'My reading' })
  })

  it('refuses blank and oversized titles, and answers an unknown Feed with not found', async () => {
    const service = await startTestService()
    const user = await claimedDevice(service)
    expect((await user.post('/api/subscriptions', { url: FEED_URL })).status).toBe(201)

    expect((await user.put('/api/feeds/1/details', { customTitle: '' })).status).toBe(400)
    expect((await user.put('/api/feeds/1/details', { customTitle: '   ' })).status).toBe(400)
    expect((await user.put('/api/feeds/1/details', { customTitle: 'a'.repeat(513) })).status).toBe(400)
    expect((await user.put('/api/feeds/1/details', {})).status).toBe(400)
    expect((await user.put('/api/feeds/99/details', { customTitle: 'Anything' })).status).toBe(404)

    const detail = await (await user.get('/api/feeds/1')).json()
    expect(detail).toMatchObject({ title: 'journal.example', customTitle: null })
  })
})

describe('Custom Title across read surfaces', () => {
  it('attributes Feed Items to the Custom Title in Digest, Library, Reader, and search results', async () => {
    const service = await startTestService()
    service.upstream.stub(FEED_URL, { headers: { 'content-type': 'application/rss+xml' }, body: rss('Field Notes') })
    const user = await claimedDevice(service)
    expect((await user.post('/api/subscriptions', { url: FEED_URL })).status).toBe(201)
    await service.wakeScheduler()
    expect((await user.put('/api/feeds/1/details', { customTitle: 'Tech tabloid' })).status).toBe(200)

    const digest = await (await user.get('/api/digest')).json()
    const item = digest.groups[0].items[0]
    expect(item).toMatchObject({ title: 'First light', feedTitle: 'Tech tabloid' })

    expect((await user.put(`/api/library/${item.feedItemId}`)).status).toBe(200)
    const library = await (await user.get('/api/library')).json()
    expect(library.items[0]).toMatchObject({ feedTitle: 'Tech tabloid' })

    const reader = await (await user.get(`/api/items/${item.feedItemId}`)).json()
    expect(reader).toMatchObject({ feedTitle: 'Tech tabloid' })

    const search = await (await user.get('/api/search?q=light')).json()
    expect(search.results[0]).toMatchObject({ feedTitle: 'Tech tabloid' })
  })

  it('sorts the Feeds list and OPML export by effective title, and export carries it in text and title', async () => {
    const service = await startTestService()
    service.upstream.stub('https://alpha.example/feed', {
      headers: { 'content-type': 'application/rss+xml' },
      body: rss('Alpha Review'),
    })
    service.upstream.stub('https://zebra.example/feed', {
      headers: { 'content-type': 'application/rss+xml' },
      body: rss('Zebra Weekly'),
    })
    const user = await claimedDevice(service)
    expect((await user.post('/api/subscriptions', { url: 'https://alpha.example/feed' })).status).toBe(201)
    expect((await user.post('/api/subscriptions', { url: 'https://zebra.example/feed' })).status).toBe(201)
    await service.wakeScheduler()

    expect((await user.put('/api/feeds/2/details', { customTitle: 'Aardvark Signal' })).status).toBe(200)

    const feeds = await (await user.get('/api/feeds')).json()
    expect(feeds.subscriptions.map((subscription: { title: string }) => subscription.title)).toEqual([
      'Aardvark Signal',
      'Alpha Review',
    ])

    const opml = await (await user.get('/api/subscriptions/export')).text()
    expect(opml).toContain('text="Aardvark Signal" title="Aardvark Signal"')
    expect(opml.indexOf('Aardvark Signal')).toBeLessThan(opml.indexOf('Alpha Review'))
  })

  it('discards the override on unsubscribe: Library attribution reverts and resubscribing starts fresh', async () => {
    const service = await startTestService()
    service.upstream.stub(FEED_URL, { headers: { 'content-type': 'application/rss+xml' }, body: rss('Field Notes') })
    const user = await claimedDevice(service)
    expect((await user.post('/api/subscriptions', { url: FEED_URL })).status).toBe(201)
    await service.wakeScheduler()
    expect((await user.put('/api/library/1')).status).toBe(200)
    expect((await user.put('/api/feeds/1/details', { customTitle: 'Tech tabloid' })).status).toBe(200)

    expect((await user.delete('/api/feeds/1')).status).toBe(204)
    const library = await (await user.get('/api/library')).json()
    expect(library.items[0]).toMatchObject({ feedTitle: 'Field Notes', subscribed: false })

    expect((await user.post('/api/subscriptions', { url: FEED_URL })).status).toBe(201)
    const detail = await (await user.get('/api/feeds/1')).json()
    expect(detail).toMatchObject({ title: 'Field Notes', customTitle: null })
  })

  it('records no Custom Title on OPML import: the outline title only stands in until the first retrieval', async () => {
    const service = await startTestService()
    service.upstream.stub(FEED_URL, { headers: { 'content-type': 'application/rss+xml' }, body: rss('Field Notes') })
    const user = await claimedDevice(service)

    const opml =
      '<?xml version="1.0" encoding="UTF-8"?><opml version="2.0"><body>' +
      `<outline type="rss" title="Placeholder Name" xmlUrl="${FEED_URL}"/>` +
      '</body></opml>'
    expect((await user.post('/api/subscriptions/import', { opml })).status).toBe(200)

    const beforePoll = await (await user.get('/api/feeds/1')).json()
    expect(beforePoll).toMatchObject({ title: 'Placeholder Name', customTitle: null })

    await service.wakeScheduler()
    const afterPoll = await (await user.get('/api/feeds/1')).json()
    expect(afterPoll).toMatchObject({ title: 'Field Notes', reportedTitle: 'Field Notes', customTitle: null })
  })
})
