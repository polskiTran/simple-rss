import { describe, expect, it } from 'vitest'
import { digestSchema, feedDetailSchema, libraryMembershipSchema, librarySchema } from '../../src/shared/api.js'
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

async function digestItem(user: Device, title: string) {
  const digest = digestSchema.parse(await (await user.get('/api/digest')).json())
  const found = digest.groups.flatMap((group) => group.items).find((entry) => entry.title === title)
  if (!found) throw new Error(`"${title}" is not in the Digest`)
  return found
}

async function library(user: Device) {
  return librarySchema.parse(await (await user.get('/api/library')).json())
}

describe('saving Feed Items to the Library', () => {
  it('saves once, no matter how often the User asks', async () => {
    const service = await startTestService()
    stubFeed(service, rss(item('one', 'First light', '2026-08-08T07:15:00.000Z')))
    const user = await claimedDevice(service)
    expect((await user.post('/api/subscriptions', { url: FEED_URL })).status).toBe(201)
    await service.wakeScheduler()
    const { feedItemId } = await digestItem(user, 'First light')

    const first = await user.put(`/api/library/${feedItemId}`)
    expect(first.status).toBe(200)
    const membership = libraryMembershipSchema.parse(await first.json())
    expect(membership).toEqual({ feedItemId, saved: true, savedAt: '2026-08-08T09:00:00.000Z' })

    service.clock.advance(60 * 60 * 1_000)
    const repeat = await user.put(`/api/library/${feedItemId}`)
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
    const user = await claimedDevice(service)
    expect((await user.post('/api/subscriptions', { url: FEED_URL })).status).toBe(201)
    await service.wakeScheduler()
    const { feedItemId } = await digestItem(user, 'First light')

    const unsaved = await user.delete(`/api/library/${feedItemId}`)
    expect(unsaved.status).toBe(200)
    expect(libraryMembershipSchema.parse(await unsaved.json())).toEqual({
      feedItemId,
      saved: false,
      savedAt: null,
    })

    expect((await user.put(`/api/library/${feedItemId}`)).status).toBe(200)
    expect((await user.delete(`/api/library/${feedItemId}`)).status).toBe(200)
    const again = await user.delete(`/api/library/${feedItemId}`)
    expect(again.status).toBe(200)
    expect((await library(user)).items).toEqual([])
  })

  it('refuses to save a Feed Item that does not exist', async () => {
    const service = await startTestService()
    const user = await claimedDevice(service)

    const response = await user.put('/api/library/999')
    expect(response.status).toBe(404)
    expect((await user.put('/api/library/not-a-number')).status).toBe(404)
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
    const user = await claimedDevice(service)
    expect((await user.post('/api/subscriptions', { url: FEED_URL })).status).toBe(201)
    await service.wakeScheduler()

    for (const title of ['A June letter', 'First light', 'Evening notes']) {
      const { feedItemId } = await digestItem(user, title)
      expect((await user.put(`/api/library/${feedItemId}`)).status).toBe(200)
    }

    const saved = await library(user)
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
    const user = await claimedDevice(service)
    expect((await user.post('/api/subscriptions', { url: FEED_URL })).status).toBe(201)
    await service.wakeScheduler()
    const { feedItemId, feedId } = await digestItem(user, 'First light')
    expect((await user.put(`/api/library/${feedItemId}`)).status).toBe(200)

    const digest = digestSchema.parse(await (await user.get('/api/digest')).json())
    expect(digest.groups.flatMap((group) => group.items).map((entry) => [entry.title, entry.saved])).toEqual([
      ['First light', true],
      ['Second thoughts', false],
    ])

    const detail = feedDetailSchema.parse(await (await user.get(`/api/feeds/${feedId}`)).json())
    expect(detail.items.map((entry) => [entry.title, entry.saved])).toEqual([
      ['First light', true],
      ['Second thoughts', false],
    ])
  })

  it('keeps a save while the publisher corrects the item metadata', async () => {
    const service = await startTestService()
    stubFeed(service, rss(item('one', 'First light', '2026-08-08T07:15:00.000Z')))
    const user = await claimedDevice(service)
    expect((await user.post('/api/subscriptions', { url: FEED_URL })).status).toBe(201)
    await service.wakeScheduler()
    const { feedItemId } = await digestItem(user, 'First light')
    expect((await user.put(`/api/library/${feedItemId}`)).status).toBe(200)

    stubFeed(service, rss(item('one', 'First light, revised', '2026-08-08T07:15:00.000Z')))
    service.clock.advance(60_000)
    expect((await user.post(`/api/feeds/1/refresh`)).status).toBe(200)

    const saved = await library(user)
    expect(saved.items.map((entry) => [entry.feedItemId, entry.title])).toEqual([[feedItemId, 'First light, revised']])
    expect((await digestItem(user, 'First light, revised')).saved).toBe(true)
  })

  it('keeps the Library across a container replacement', async () => {
    const service = await startTestService()
    stubFeed(service, rss(item('one', 'First light', '2026-08-08T07:15:00.000Z')))
    const user = await claimedDevice(service)
    expect((await user.post('/api/subscriptions', { url: FEED_URL })).status).toBe(201)
    await service.wakeScheduler()
    const { feedItemId } = await digestItem(user, 'First light')
    expect((await user.put(`/api/library/${feedItemId}`)).status).toBe(200)

    await service.restart()

    const saved = await library(user)
    expect(saved.items.map((entry) => [entry.title, entry.savedAt])).toEqual([
      ['First light', '2026-08-08T09:00:00.000Z'],
    ])
  })

  it('shows both devices the same Library, immediately', async () => {
    const service = await startTestService()
    stubFeed(service, rss(item('one', 'First light', '2026-08-08T07:15:00.000Z')))
    const phone = await claimedDevice(service)
    expect((await phone.post('/api/subscriptions', { url: FEED_URL })).status).toBe(201)
    await service.wakeScheduler()
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
