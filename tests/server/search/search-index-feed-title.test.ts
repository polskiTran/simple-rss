import { asc } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { digestSchema } from '../../../src/shared/api.js'
import { feedItemSearch } from '../../../src/server/search/search-schema.js'
import { claimedDevice, type Device } from '../../support/device.js'
import { startTestService, type TestService } from '../../support/service-harness.js'

const FEED_URL = 'https://journal.example/feed'

const rss = (title: string) => `<?xml version="1.0"?>
  <rss version="2.0"><channel><title>${title}</title><link>https://journal.example/</link>
    <item><guid isPermaLink="false">a</guid><title>Morning chronology</title></item>
    <item><guid isPermaLink="false">b</guid><title>Evening chronology</title></item>
  </channel></rss>`

const publish = (service: TestService, title: string) =>
  service.upstream.stub(FEED_URL, { headers: { 'content-type': 'application/rss+xml' }, body: rss(title) })

function indexedFeedTitles(service: TestService) {
  return service.database
    .select({ feedItemId: feedItemSearch.rowid, feedTitle: feedItemSearch.feedTitle })
    .from(feedItemSearch)
    .orderBy(asc(feedItemSearch.rowid))
    .all()
}

async function digestFeedTitles(user: Device) {
  const digest = digestSchema.parse(await (await user.get('/api/digest')).json())
  return digest.groups
    .flatMap((group) => group.items)
    .map(({ feedItemId, feedTitle }) => ({ feedItemId, feedTitle }))
    .toSorted((a, b) => a.feedItemId - b.feedItemId)
}

async function expectIndexToShowDigestTitle(service: TestService, user: Device, title: string) {
  const shown = await digestFeedTitles(user)
  expect(shown.map((entry) => entry.feedTitle)).toEqual([title, title])
  expect(indexedFeedTitles(service)).toEqual(shown)
}

describe('the search index keeps the Feed title the Digest shows', () => {
  it('follows a publisher rename', async () => {
    const service = await startTestService()
    const user = await claimedDevice(service)
    publish(service, 'Field Notes')
    expect((await user.post('/api/subscriptions', { url: FEED_URL })).status).toBe(201)
    await expectIndexToShowDigestTitle(service, user, 'Field Notes')

    publish(service, 'Estuary Notes')
    service.clock.advance(60_000)
    expect((await user.post('/api/feeds/1/refresh')).status).toBe(200)

    await expectIndexToShowDigestTitle(service, user, 'Estuary Notes')
  })

  it('follows a Custom Title being set, outlasting a rename, and being cleared', async () => {
    const service = await startTestService()
    const user = await claimedDevice(service)
    publish(service, 'Field Notes')
    expect((await user.post('/api/subscriptions', { url: FEED_URL })).status).toBe(201)

    const details = (customTitle: string | null) =>
      user.put('/api/feeds/1/details', { customTitle, customDescription: null })

    expect((await details('Tech Tabloid')).status).toBe(200)
    await expectIndexToShowDigestTitle(service, user, 'Tech Tabloid')

    publish(service, 'Estuary Notes')
    service.clock.advance(60_000)
    expect((await user.post('/api/feeds/1/refresh')).status).toBe(200)
    await expectIndexToShowDigestTitle(service, user, 'Tech Tabloid')

    expect((await details(null)).status).toBe(200)
    await expectIndexToShowDigestTitle(service, user, 'Estuary Notes')
  })
})
