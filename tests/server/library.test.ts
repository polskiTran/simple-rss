import { describe, expect, it } from 'vitest'
import {
  digestSchema,
  feedDetailSchema,
  libraryMembershipSchema,
  librarySchema,
} from '../../src/shared/api.js'
import { claimedDevice, Device } from '../support/device.js'
import { startTestService, type TestService } from '../support/service-harness.js'

const FEED_URL = 'https://journal.example/feed'

const item = (guid: string, title: string, pubDate?: string) => `
  <item>
    <guid>${guid}</guid>
    <title>${title}</title>
    <link>https://journal.example/${guid}</link>
    ${pubDate ? `<pubDate>${new Date(pubDate).toUTCString()}</pubDate>` : ''}
  </item>`

const rss = (...items: string[]) => `<?xml version="1.0"?>
  <rss version="2.0"><channel><title>Field Notes</title>${items.join('')}</channel></rss>`

const stubFeed = (service: TestService, body: string) =>
  service.upstream.stub(FEED_URL, { headers: { 'content-type': 'application/rss+xml' }, body })

/** The Digest's view of one Feed Item, found by title, so tests speak titles. */
async function digestItem(owner: Device, title: string) {
  const digest = digestSchema.parse(await (await owner.get('/api/digest')).json())
  const found = digest.groups.flatMap((group) => group.items).find((entry) => entry.title === title)
  if (!found) throw new Error(`"${title}" is not in the Digest`)
  return found
}

async function library(owner: Device) {
  return librarySchema.parse(await (await owner.get('/api/library')).json())
}

describe('saving Feed Items to the Library', () => {
  it('saves once, no matter how often the Owner asks', async () => {
    const service = await startTestService()
    stubFeed(service, rss(item('one', 'First light', '2026-08-08T07:15:00.000Z')))
    const owner = await claimedDevice(service)
    expect((await owner.post('/api/subscriptions', { url: FEED_URL })).status).toBe(201)
    const { feedItemId } = await digestItem(owner, 'First light')

    const first = await owner.put(`/api/library/${feedItemId}`)
    expect(first.status).toBe(200)
    const membership = libraryMembershipSchema.parse(await first.json())
    expect(membership).toEqual({ feedItemId, saved: true, savedAt: '2026-08-08T09:00:00.000Z' })

    // An hour later the Owner's other device repeats the save. The membership
    // it answers with is the original one, not a fresh save.
    service.clock.advance(60 * 60 * 1_000)
    const repeat = await owner.put(`/api/library/${feedItemId}`)
    expect(repeat.status).toBe(200)
    expect(libraryMembershipSchema.parse(await repeat.json())).toEqual(membership)

    const rows = service.database?.prepare('select count(*) as saved from library_items').get() as {
      saved: number
    }
    expect(rows.saved).toBe(1)
  })

  it('answers an unsave calmly even when nothing was saved', async () => {
    const service = await startTestService()
    stubFeed(service, rss(item('one', 'First light', '2026-08-08T07:15:00.000Z')))
    const owner = await claimedDevice(service)
    expect((await owner.post('/api/subscriptions', { url: FEED_URL })).status).toBe(201)
    const { feedItemId } = await digestItem(owner, 'First light')

    // Never saved, unsaved anyway: the state it asked for already holds.
    const unsaved = await owner.delete(`/api/library/${feedItemId}`)
    expect(unsaved.status).toBe(200)
    expect(libraryMembershipSchema.parse(await unsaved.json())).toEqual({
      feedItemId,
      saved: false,
      savedAt: null,
    })

    expect((await owner.put(`/api/library/${feedItemId}`)).status).toBe(200)
    expect((await owner.delete(`/api/library/${feedItemId}`)).status).toBe(200)
    const again = await owner.delete(`/api/library/${feedItemId}`)
    expect(again.status).toBe(200)
    expect((await library(owner)).items).toEqual([])
  })

  it('refuses to save a Feed Item that does not exist', async () => {
    const service = await startTestService()
    const owner = await claimedDevice(service)

    const response = await owner.put('/api/library/999')
    expect(response.status).toBe(404)
    expect((await owner.put('/api/library/not-a-number')).status).toBe(404)
  })

  it('lists the Library in Digest chronology with source attribution', async () => {
    const service = await startTestService()
    stubFeed(
      service,
      rss(
        item('june', 'A June letter', '2026-06-03T12:00:00.000Z'),
        item('today', 'First light', '2026-08-08T07:15:00.000Z'),
        item('yesterday', 'Evening notes', '2026-08-07T09:31:00.000Z'),
      ),
    )
    const owner = await claimedDevice(service)
    expect((await owner.post('/api/subscriptions', { url: FEED_URL })).status).toBe(201)

    // Saved oldest-publication first, to prove the list orders by the item's
    // own chronology rather than by when the Owner saved.
    for (const title of ['A June letter', 'First light', 'Evening notes']) {
      const { feedItemId } = await digestItem(owner, title)
      expect((await owner.put(`/api/library/${feedItemId}`)).status).toBe(200)
    }

    const saved = await library(owner)
    expect(saved.items.map((entry) => [entry.title, entry.feedTitle, entry.displayDate])).toEqual([
      ['First light', 'Field Notes', 'today, 07:15'],
      ['Evening notes', 'Field Notes', 'yesterday, 09:31'],
      ['A June letter', 'Field Notes', '3 june'],
    ])
    expect(saved.items.map((entry) => entry.savedAt)).toEqual([
      '2026-08-08T09:00:00.000Z',
      '2026-08-08T09:00:00.000Z',
      '2026-08-08T09:00:00.000Z',
    ])
  })

  it('marks saved state in the Digest and the opened Feed', async () => {
    const service = await startTestService()
    stubFeed(
      service,
      rss(
        item('one', 'First light', '2026-08-08T07:15:00.000Z'),
        item('two', 'Second thoughts', '2026-08-08T06:40:00.000Z'),
      ),
    )
    const owner = await claimedDevice(service)
    expect((await owner.post('/api/subscriptions', { url: FEED_URL })).status).toBe(201)
    const { feedItemId, feedId } = await digestItem(owner, 'First light')
    expect((await owner.put(`/api/library/${feedItemId}`)).status).toBe(200)

    const digest = digestSchema.parse(await (await owner.get('/api/digest')).json())
    expect(
      digest.groups.flatMap((group) => group.items).map((entry) => [entry.title, entry.saved]),
    ).toEqual([
      ['First light', true],
      ['Second thoughts', false],
    ])

    const detail = feedDetailSchema.parse(await (await owner.get(`/api/feeds/${feedId}`)).json())
    expect(detail.items.map((entry) => [entry.title, entry.saved])).toEqual([
      ['First light', true],
      ['Second thoughts', false],
    ])
  })

  it('keeps a save while the publisher corrects the item metadata', async () => {
    const service = await startTestService()
    stubFeed(service, rss(item('one', 'First light', '2026-08-08T07:15:00.000Z')))
    const owner = await claimedDevice(service)
    expect((await owner.post('/api/subscriptions', { url: FEED_URL })).status).toBe(201)
    const { feedItemId } = await digestItem(owner, 'First light')
    expect((await owner.put(`/api/library/${feedItemId}`)).status).toBe(200)

    // The publisher retitles the same entry; a manual refresh ingests it.
    stubFeed(service, rss(item('one', 'First light, revised', '2026-08-08T07:15:00.000Z')))
    expect((await owner.post(`/api/feeds/1/refresh`)).status).toBe(200)

    const saved = await library(owner)
    expect(saved.items.map((entry) => [entry.feedItemId, entry.title])).toEqual([
      [feedItemId, 'First light, revised'],
    ])
    expect((await digestItem(owner, 'First light, revised')).saved).toBe(true)
  })

  it('keeps the Library across a container replacement', async () => {
    const service = await startTestService()
    stubFeed(service, rss(item('one', 'First light', '2026-08-08T07:15:00.000Z')))
    const owner = await claimedDevice(service)
    expect((await owner.post('/api/subscriptions', { url: FEED_URL })).status).toBe(201)
    const { feedItemId } = await digestItem(owner, 'First light')
    expect((await owner.put(`/api/library/${feedItemId}`)).status).toBe(200)

    await service.restart()

    const saved = await library(owner)
    expect(saved.items.map((entry) => [entry.title, entry.savedAt])).toEqual([
      ['First light', '2026-08-08T09:00:00.000Z'],
    ])
  })

  it('shows both devices the same Library, immediately', async () => {
    const service = await startTestService()
    stubFeed(service, rss(item('one', 'First light', '2026-08-08T07:15:00.000Z')))
    const phone = await claimedDevice(service)
    expect((await phone.post('/api/subscriptions', { url: FEED_URL })).status).toBe(201)
    const laptop = new Device(service)
    expect((await laptop.signIn()).status).toBe(200)

    const { feedItemId } = await digestItem(phone, 'First light')
    expect((await phone.put(`/api/library/${feedItemId}`)).status).toBe(200)

    expect((await library(laptop)).items.map((entry) => entry.title)).toEqual(['First light'])
    expect((await digestItem(laptop, 'First light')).saved).toBe(true)

    expect((await laptop.delete(`/api/library/${feedItemId}`)).status).toBe(200)
    expect((await library(phone)).items).toEqual([])
    expect((await digestItem(phone, 'First light')).saved).toBe(false)
  })

  it('is closed to anyone without a session', async () => {
    const service = await startTestService()
    await claimedDevice(service)
    const stranger = new Device(service)

    expect((await stranger.get('/api/library')).status).toBe(401)
    expect((await stranger.put('/api/library/1')).status).toBe(401)
    expect((await stranger.delete('/api/library/1')).status).toBe(401)
  })
})
