import { describe, expect, it } from 'vitest'
import { searchResultsSchema, type SearchResults } from '../../src/shared/api.js'
import { rebuildSearchIndex, SEARCH_RESULT_LIMIT } from '../../src/server/search/search-service.js'
import { claimedDevice, Device } from '../support/device.js'
import { startTestService, type TestService } from '../support/service-harness.js'

const MINUTE_MS = 60_000
const HOUR_MS = 60 * MINUTE_MS
const DAY_MS = 24 * HOUR_MS

const FEED_URL = 'https://journal.example/feed'
const FEED_HEADERS = { 'content-type': 'application/rss+xml; charset=utf-8' }

const item = (guid: string, title: string, options: { pubDate?: string; summary?: string } = {}) => `
  <item>
    <guid isPermaLink="false">${guid}</guid>
    <title>${title}</title>
    <link>https://journal.example/${guid}</link>
    ${options.pubDate ? `<pubDate>${new Date(options.pubDate).toUTCString()}</pubDate>` : ''}
    ${options.summary ? `<description>${options.summary}</description>` : ''}
  </item>`

const rss = (title: string, ...items: string[]) => `<?xml version="1.0"?>
  <rss version="2.0"><channel><title>${title}</title><link>https://journal.example/</link>${items.join('')}</channel></rss>`

const stubFeed = (service: TestService, body: string, url: string = FEED_URL) =>
  service.upstream.stub(url, { headers: FEED_HEADERS, body })

/** Subscribes the User to a Feed currently exposing the given document. */
async function subscribed(user: Device, service: TestService, xml: string, url: string = FEED_URL): Promise<void> {
  stubFeed(service, xml, url)
  const response = await user.post('/api/subscriptions', { url })
  expect(response.status).toBe(201)
}

async function search(user: Device, query: string): Promise<SearchResults> {
  const response = await user.get(`/api/search?q=${encodeURIComponent(query)}`)
  expect(response.status).toBe(200)
  return searchResultsSchema.parse(await response.json())
}

async function foundTitles(user: Device, query: string): Promise<string[]> {
  return (await search(user, query)).results.map((result) => result.title)
}

describe('searching retained reading metadata', () => {
  it('finds Feed Items by their title, their summary, and their Feed title alike', async () => {
    const service = await startTestService()
    const user = await claimedDevice(service)
    await subscribed(
      user,
      service,
      rss(
        'Field Notes',
        item('a', 'Morning chronology', { pubDate: '2026-08-08T07:15:00.000Z' }),
        item('b', 'Evening walk', {
          pubDate: '2026-08-07T20:00:00.000Z',
          summary: 'Notes on tidal patterns along the estuary',
        }),
      ),
    )

    // A word from an item title.
    expect(await foundTitles(user, 'chronology')).toEqual(['Morning chronology'])
    // A word only the normalized summary carries.
    expect(await foundTitles(user, 'estuary')).toEqual(['Evening walk'])
    // A word from the Feed's own title matches everything it published.
    expect(await foundTitles(user, 'field notes')).toEqual(['Morning chronology', 'Evening walk'])

    // The result identifies the item: title, Feed, date, and saved state.
    const [result] = (await search(user, 'chronology')).results
    expect(result).toEqual({
      feedItemId: 1,
      title: 'Morning chronology',
      feedId: 1,
      feedTitle: 'Field Notes',
      publishedAt: '2026-08-08T07:15:00.000Z',
      firstSeenAt: '2026-08-08T09:00:00.000Z',
      displayDate: 'today, 07:15',
      saved: false,
    })
  })

  it('matches calmly through typing, diacritics, and would-be operators', async () => {
    const service = await startTestService()
    const user = await claimedDevice(service)
    await subscribed(
      user,
      service,
      rss(
        'Field Notes',
        item('a', 'Résumé of the médiathèque visit', { pubDate: '2026-08-08T07:15:00.000Z' }),
        item('b', 'Coffee AND ordering', { pubDate: '2026-08-08T06:00:00.000Z' }),
      ),
    )

    // The last word matches as a prefix, so search-as-you-type converges.
    expect(await foundTitles(user, 'medi')).toEqual(['Résumé of the médiathèque visit'])
    // Diacritics fold both ways.
    expect(await foundTitles(user, 'resume')).toEqual(['Résumé of the médiathèque visit'])
    expect(await foundTitles(user, 'résumé')).toEqual(['Résumé of the médiathèque visit'])
    // Words must all match, not any: both items say "of"/"and"-adjacent words,
    // only one says both "resume" and "visit".
    expect(await foundTitles(user, 'resume visit')).toEqual(['Résumé of the médiathèque visit'])
    expect(await foundTitles(user, 'resume espresso')).toEqual([])

    // FTS5 syntax arrives as words, never as operators or errors.
    expect(await foundTitles(user, 'AND')).toEqual(['Coffee AND ordering'])
    expect(await foundTitles(user, 'coffee NOT ordering')).toEqual([])
    expect(await foundTitles(user, '"coffee')).toEqual(['Coffee AND ordering'])
    expect(await foundTitles(user, 'coffee*)^ ord')).toEqual(['Coffee AND ordering'])
    // Nothing tokenizable is an empty answer, not a syntax error.
    expect(await foundTitles(user, '"*() -')).toEqual([])
  })

  it('says nothing matched with an empty result, not an error', async () => {
    const service = await startTestService()
    const user = await claimedDevice(service)
    await subscribed(user, service, rss('Field Notes', item('a', 'Morning light')))

    expect(await search(user, 'nonexistent')).toEqual({ results: [] })
  })

  it('follows metadata corrections: a retitled item and a renamed Feed', async () => {
    const service = await startTestService()
    const user = await claimedDevice(service)
    await subscribed(
      user,
      service,
      rss('Field Notes', item('a', 'Draft impressions', { summary: 'First thoughts' })),
    )
    expect(await foundTitles(user, 'draft')).toEqual(['Draft impressions'])

    // The publisher retitles the entry, rewrites its summary, and renames the
    // Feed itself; a manual refresh ingests all three corrections.
    stubFeed(
      service,
      rss('Estuary Notes', item('a', 'Settled impressions', { summary: 'Second thoughts' })),
    )
    expect((await user.post('/api/feeds/1/refresh')).status).toBe(200)

    expect(await foundTitles(user, 'settled')).toEqual(['Settled impressions'])
    expect(await foundTitles(user, 'second')).toEqual(['Settled impressions'])
    expect(await foundTitles(user, 'estuary')).toEqual(['Settled impressions'])
    // The stale words are gone the moment the correction lands.
    expect(await foundTitles(user, 'draft')).toEqual([])
    expect(await foundTitles(user, 'first')).toEqual([])
    expect(await foundTitles(user, 'field')).toEqual([])
  })

  it('keeps finding a Library item whose Feed the User unsubscribed', async () => {
    const service = await startTestService()
    const user = await claimedDevice(service)
    await subscribed(user, service, rss('Field Notes', item('a', 'Saved essay'), item('b', 'Passing note')))
    expect((await user.put('/api/library/1')).status).toBe(200)

    expect((await user.delete('/api/feeds/1')).status).toBe(204)

    // Before the sweep even runs, the unsaved item is already out of search —
    // it left the Digest at unsubscribe, and search must agree.
    expect(await foundTitles(user, 'passing')).toEqual([])
    expect(await foundTitles(user, 'saved essay')).toEqual(['Saved essay'])

    await service.wakeScheduler()

    // After cleanup the save is still found, still attributed.
    const [result] = (await search(user, 'saved essay')).results
    expect([result?.title, result?.feedTitle, result?.saved]).toEqual(['Saved essay', 'Field Notes', true])
    expect(await foundTitles(user, 'passing')).toEqual([])
  })

  it('forgets pruned history: an expired unsaved item cannot survive in the index', async () => {
    const service = await startTestService()
    const user = await claimedDevice(service)
    await subscribed(user, service, rss('Field Notes', item('a', 'Kept'), item('b', 'Dropped')))
    stubFeed(service, rss('Field Notes', item('a', 'Kept')))

    service.clock.advance(91 * DAY_MS)
    await service.wakeScheduler()

    expect((await user.signIn()).status).toBe(200)
    expect(await foundTitles(user, 'kept')).toEqual(['Kept'])
    expect(await foundTitles(user, 'dropped')).toEqual([])
    // Gone from the index itself, not merely filtered out of the answer.
    const orphaned = service.database
      ?.prepare("SELECT count(*) AS rows FROM feed_item_search WHERE feed_item_search MATCH 'dropped'")
      .get() as { rows: number }
    expect(orphaned.rows).toBe(0)
  })

  it('answers identically after the index is dropped and rebuilt from canonical tables', async () => {
    const service = await startTestService()
    const user = await claimedDevice(service)
    await subscribed(
      user,
      service,
      rss(
        'Field Notes',
        item('a', 'Morning chronology', { summary: 'Tidal notes' }),
        item('b', 'Evening walk'),
      ),
    )
    expect((await user.put('/api/library/2')).status).toBe(200)

    const before = await search(user, 'notes')
    expect(before.results).toHaveLength(2)

    // The derived index is lost or corrupted; the canonical tables are not.
    service.database?.exec('DELETE FROM feed_item_search')
    expect(await search(user, 'notes')).toEqual({ results: [] })

    if (!service.database) throw new Error('the service has no open database')
    rebuildSearchIndex(service.database)
    expect(await search(user, 'notes')).toEqual(before)
    // And the triggers keep maintaining the rebuilt index.
    stubFeed(service, rss('Field Notes', item('a', 'Morning chronology, revised', { summary: 'Tidal notes' })))
    expect((await user.post('/api/feeds/1/refresh')).status).toBe(200)
    expect(await foundTitles(user, 'revised')).toEqual(['Morning chronology, revised'])
  })

  it('bounds every answer at the newest fifty matches', async () => {
    const service = await startTestService()
    const user = await claimedDevice(service)
    const many = Array.from({ length: SEARCH_RESULT_LIMIT + 5 }, (_, index) =>
      item(`n${index}`, `Numbered entry ${index}`, {
        pubDate: new Date(Date.UTC(2026, 5, 1, 12, index)).toISOString(),
      }),
    )
    await subscribed(user, service, rss('Field Notes', ...many))

    const { results } = await search(user, 'numbered')
    expect(results).toHaveLength(SEARCH_RESULT_LIMIT)
    // The bound keeps the newest matches, in Digest chronology.
    expect(results[0]?.title).toBe(`Numbered entry ${SEARCH_RESULT_LIMIT + 4}`)
    expect(results.at(-1)?.title).toBe('Numbered entry 5')
  })

  it('does not let a broken publisher clock crowd the bound from the future', async () => {
    const service = await startTestService()
    const user = await claimedDevice(service)
    const futureItem = item('z', 'Numbered entry future', { pubDate: '2999-01-01T00:00:00.000Z' })
    await subscribed(user, service, rss('Field Notes', futureItem))

    // Two hours on, the Feed exposes a full page of plausibly dated items.
    service.clock.advance(2 * HOUR_MS)
    const many = Array.from({ length: SEARCH_RESULT_LIMIT + 5 }, (_, index) =>
      item(`n${index}`, `Numbered entry ${index}`, {
        pubDate: new Date(Date.UTC(2026, 7, 8, 10, index)).toISOString(),
      }),
    )
    stubFeed(service, rss('Field Notes', futureItem, ...many))
    expect((await user.post('/api/feeds/1/refresh')).status).toBe(200)

    // The year-2999 item orders by when it was first seen — the oldest match
    // here — so it cannot hold a bound slot the newest matches deserve.
    const { results } = await search(user, 'numbered')
    expect(results).toHaveLength(SEARCH_RESULT_LIMIT)
    expect(results.map((entry) => entry.title)).not.toContain('Numbered entry future')
    expect(results[0]?.title).toBe(`Numbered entry ${SEARCH_RESULT_LIMIT + 4}`)
    expect(results.at(-1)?.title).toBe('Numbered entry 5')
  })

  it('refuses a missing, empty, or oversized query as a bad request', async () => {
    const service = await startTestService()
    const user = await claimedDevice(service)

    expect((await user.get('/api/search')).status).toBe(400)
    expect((await user.get('/api/search?q=')).status).toBe(400)
    expect((await user.get(`/api/search?q=${'a'.repeat(300)}`)).status).toBe(400)
  })

  it('is closed to anyone without a session and never cached', async () => {
    const service = await startTestService()
    const user = await claimedDevice(service)
    const stranger = new Device(service)

    expect((await stranger.get('/api/search?q=anything')).status).toBe(401)

    const answered = await user.get('/api/search?q=anything')
    expect(answered.status).toBe(200)
    expect(answered.headers.get('cache-control')).toBe('no-store')
  })
})
