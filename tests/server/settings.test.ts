import { describe, expect, it } from 'vitest'
import { digestSchema, installationPreferencesSchema } from '../../src/shared/api.js'
import { claimedDevice, Device } from '../support/device.js'
import { USER_PASSWORD, SETUP_SECRET, startTestService } from '../support/service-harness.js'

const FEED_URL = 'https://journal.example/feed'

// 20:00 UTC on the 7th: yesterday in UTC, already today in Auckland.
const RSS = `<?xml version="1.0"?>
  <rss version="2.0"><channel><title>Field Notes</title>
    <item>
      <guid>one</guid>
      <title>Crossing midnight</title>
      <link>https://journal.example/one</link>
      <pubDate>${new Date('2026-08-07T20:00:00.000Z').toUTCString()}</pubDate>
    </item>
  </channel></rss>`

describe('installation timezone detection at claim', () => {
  it('seeds the settings row with the zone the claiming browser offered', async () => {
    const service = await startTestService()
    const device = new Device(service)

    const claimed = await device.post('/api/auth/setup', {
      setupSecret: SETUP_SECRET,
      password: USER_PASSWORD,
      timezone: 'Pacific/Auckland',
    })

    expect(claimed.status).toBe(201)
    expect(service.settings?.read()?.timezone).toBe('Pacific/Auckland')
    expect(await (await device.get('/api/settings')).json()).toEqual({ timezone: 'Pacific/Auckland' })
  })

  it('claims on UTC when the browser offers no zone or an unresolvable one', async () => {
    const service = await startTestService()
    const device = new Device(service)

    const claimed = await device.post('/api/auth/setup', {
      setupSecret: SETUP_SECRET,
      password: USER_PASSWORD,
      timezone: 'Mars/Olympus_Mons',
    })

    expect(claimed.status).toBe(201)
    expect(service.settings?.read()).toBeUndefined()
    expect(await (await device.get('/api/settings')).json()).toEqual({ timezone: 'UTC' })
  })

  it('does not spend the timezone on a rejected claim', async () => {
    const service = await startTestService()
    const device = new Device(service)

    const refused = await device.post('/api/auth/setup', {
      setupSecret: 'not-the-setup-secret',
      password: USER_PASSWORD,
      timezone: 'Pacific/Auckland',
    })

    expect(refused.status).toBe(401)
    expect(service.settings?.read()).toBeUndefined()
  })
})

describe('the Settings preferences API', () => {
  it('is closed to anyone without a session', async () => {
    const service = await startTestService()
    const stranger = new Device(service)

    expect((await stranger.get('/api/settings')).status).toBe(401)
    expect((await stranger.put('/api/settings/timezone', { timezone: 'UTC' })).status).toBe(401)
  })

  it('lets the User change the installation timezone, regrouping the Digest', async () => {
    const service = await startTestService()
    service.upstream.stub(FEED_URL, { headers: { 'content-type': 'application/rss+xml' }, body: RSS })
    const user = await claimedDevice(service)
    expect((await user.post('/api/subscriptions', { url: FEED_URL })).status).toBe(201)
    await service.wakeScheduler()

    const before = digestSchema.parse(await (await user.get('/api/digest')).json())
    expect(before.groups.map(({ label }) => label)).toEqual(['yesterday'])

    const changed = await user.put('/api/settings/timezone', { timezone: 'Pacific/Auckland' })
    expect(changed.status).toBe(200)
    expect(installationPreferencesSchema.parse(await changed.json())).toEqual({
      timezone: 'Pacific/Auckland',
    })

    // One installation timezone defines calendar groups across devices: the
    // same stored instant now reads as today.
    const after = digestSchema.parse(await (await user.get('/api/digest')).json())
    expect(after.groups.map(({ label }) => label)).toEqual(['today'])
    expect(after.today).toEqual({ date: '2026-08-08', volume: 1 })
  })

  it('survives a restart, like any other installation state', async () => {
    const service = await startTestService()
    const user = await claimedDevice(service)
    expect((await user.put('/api/settings/timezone', { timezone: 'Europe/Warsaw' })).status).toBe(200)

    await service.restart()

    expect(service.settings?.read()?.timezone).toBe('Europe/Warsaw')
  })

  it('refuses a timezone the runtime cannot resolve', async () => {
    const service = await startTestService()
    const user = await claimedDevice(service)

    const refused = await user.put('/api/settings/timezone', { timezone: 'Mars/Olympus_Mons' })

    expect(refused.status).toBe(400)
    expect(await refused.json()).toMatchObject({ error: { code: 'unknown_timezone' } })
    expect(service.settings?.read()).toBeUndefined()
  })

  it('refuses a body that is not a timezone at all', async () => {
    const service = await startTestService()
    const user = await claimedDevice(service)

    expect((await user.put('/api/settings/timezone', { timezone: '' })).status).toBe(400)
    expect((await user.put('/api/settings/timezone', {})).status).toBe(400)
  })
})
