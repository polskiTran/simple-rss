import { render, screen, waitFor, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App } from '../../src/client/app.js'
import { cadenceWindow } from './cadence-window.js'
import type { Digest } from '../../src/shared/api.js'
import { day, digest, digestGroup, digestItem, subscription } from './fixtures.js'
import { stubApi } from './stub-api.js'

const item = (feedItemId: number, title: string, displayTime: string, feedId = 1, feedTitle = 'Field Notes') =>
  digestItem({ feedItemId, title, displayTime, feedId, feedTitle, link: `https://journal.example/${feedItemId}` })

const TODAY = digestGroup({ items: [item(3, 'First light', '07:15'), item(2, 'Second thoughts', '06:40')] })
const YESTERDAY = digestGroup({ date: day('2026-08-07'), items: [item(1, 'Evening notes', '09:31')] })
const JUNE = digestGroup({ date: day('2026-06-03'), items: [item(4, 'A June letter', '12:00')] })

const DIGEST = digest({ groups: [TODAY, YESTERDAY, JUNE] })

afterEach(() => {
  vi.unstubAllGlobals()
})

function openDigest(path = '/') {
  window.history.replaceState(null, '', path)
  return render(<App />)
}

describe('the Digest', () => {
  it('keeps its title for screen readers and heads each day by its name', async () => {
    stubApi().on('GET /api/digest', { body: DIGEST })
    const { container } = openDigest()

    expect(await screen.findByRole('heading', { level: 2, name: 'Today' })).toBeDefined()
    expect(screen.getByRole('heading', { level: 1, name: 'Digest' }).className).toBe('visually-hidden')
    expect(screen.getByRole('heading', { level: 2, name: 'Yesterday' })).toBeDefined()
    expect(screen.getByRole('heading', { level: 2, name: 'Wednesday 3 June' })).toBeDefined()

    const today = screen.getByRole('region', { name: 'Today' })
    expect(within(today).getAllByRole('link', { name: 'Field Notes' })[0]?.getAttribute('href')).toBe('/feeds/1')
    expect(within(today).getByText('07:15')).toBeDefined()
    expect(screen.getByRole('button', { name: 'Save First light' }).getAttribute('aria-pressed')).toBe('false')
    expect(container.textContent).not.toMatch(/unread|archive/i)
  })

  it('shows older days from the day the page names, under the days already shown', async () => {
    const api = stubApi()
      .on('GET /api/digest', { body: digest({ groups: [TODAY, YESTERDAY], nextFrom: day('2026-06-03') }) })
      .on('GET /api/digest?from=2026-06-03', { body: digest({ groups: [JUNE] }) })
    openDigest()
    const user = userEvent.setup()

    await screen.findByRole('heading', { level: 2, name: 'Yesterday' })
    await user.click(screen.getByRole('button', { name: 'Show older days' }))

    expect(await screen.findByRole('heading', { level: 2, name: 'Wednesday 3 June' })).toBeDefined()
    expect(screen.getByRole('heading', { level: 2, name: 'Today' })).toBeDefined()
    expect(api.requestsTo('GET /api/digest?from=2026-06-03')).toHaveLength(1)
    expect(screen.queryByRole('button', { name: 'Show older days' })).toBeNull()
  })

  it('folds a Firehose Feed’s day into one row, unfolds it, and folds it again', async () => {
    const wire = subscription({ feedId: 2, title: 'Wire', cadence: Array.from({ length: 30 }, () => 5) })
    const titles = ['One', 'Two', 'Three']
    stubApi()
      .on('GET /api/feeds', { body: { subscriptions: [subscription(), wire] } })
      .on('GET /api/digest', {
        body: digest({
          groups: [
            digestGroup({
              items: [
                item(3, 'First light', '07:15'),
                ...titles.map((title, index) => item(20 - index, title, `0${6 - index}:00`, 2, 'Wire')),
              ],
            }),
          ],
        }),
      })
    openDigest()
    const user = userEvent.setup()

    const fold = await screen.findByRole('button', { name: '3 Feed Items from Wire' })
    expect(screen.queryByRole('link', { name: 'Two' })).toBeNull()

    await user.click(fold)

    expect(titles.map((title) => screen.getByRole('link', { name: title }).textContent)).toEqual(titles)
    await user.click(screen.getByRole('button', { name: 'Fold 3 Feed Items from Wire' }))

    expect(await screen.findByRole('button', { name: '3 Feed Items from Wire', expanded: false })).toBeDefined()
    expect(screen.queryByRole('link', { name: 'Two' })).toBeNull()
  })

  it('names a saved title as saved', async () => {
    stubApi().on('GET /api/digest', {
      body: digest({ groups: [digestGroup({ items: [{ ...item(3, 'First light', '07:15'), saved: true }] })] }),
    })
    openDigest()

    expect((await screen.findByRole('button', { name: 'Saved First light' })).getAttribute('aria-pressed')).toBe('true')
  })

  it('flips save to saved in place once the server confirms, and back', async () => {
    const api = stubApi()
      .on('GET /api/digest', { body: DIGEST })
      .on('PUT /api/library/3', { body: { feedItemId: 3, saved: true, savedAt: '2026-08-08T09:05:00.000Z' } })
      .on('DELETE /api/library/3', { body: { feedItemId: 3, saved: false, savedAt: null } })
    openDigest()
    const user = userEvent.setup()

    const toggle = await screen.findByRole('button', { name: 'Save First light' })
    await user.click(toggle)

    await waitFor(() => expect(toggle.getAttribute('aria-pressed')).toBe('true'))
    expect(api.requestsTo('PUT /api/library/3')).toHaveLength(1)

    await user.click(toggle)

    await waitFor(() => expect(toggle.getAttribute('aria-pressed')).toBe('false'))
    expect(api.requestsTo('DELETE /api/library/3')).toHaveLength(1)
  })

  it('keeps saying save when the server refuses the save', async () => {
    stubApi()
      .on('GET /api/digest', { body: DIGEST })
      .on('PUT /api/library/3', { status: 503, body: { error: { code: 'unavailable', message: 'Unavailable' } } })
    openDigest()
    const user = userEvent.setup()

    const toggle = await screen.findByRole('button', { name: 'Save First light' })
    await user.click(toggle)

    await waitFor(() => expect(toggle.getAttribute('aria-pressed')).toBe('false'))
  })

  it('leads to Add a Feed before any Subscription', async () => {
    stubApi().on('GET /api/digest/days', { body: { today: '2026-08-08', days: cadenceWindow(), subscriptions: 0 } })
    openDigest()

    expect(await screen.findByText(/No Feeds yet\./)).toBeDefined()
    expect(screen.getByRole('link', { name: 'Add a Feed' }).getAttribute('href')).toBe('/feeds')
  })

  it('says Feed Items are on their way when Subscriptions have yet to publish', async () => {
    stubApi()
    openDigest()

    expect(await screen.findByText(/Nothing yet\. Feed Items land here as your Feeds publish\./)).toBeDefined()
    expect(screen.getByRole('link', { name: 'See your Feeds' }).getAttribute('href')).toBe('/feeds')
    expect(screen.queryByRole('link', { name: 'Add a Feed' })).toBeNull()
  })

  it('counts a request that ran out of time as unreached', async () => {
    stubApi().on('GET /api/digest', () => {
      throw new DOMException('The operation timed out', 'TimeoutError')
    })
    openDigest()

    expect(await screen.findByText(/The Digest can’t be reached\./)).toBeDefined()
  })

  it('blames the reader, not the connection, when the answer fails its schema', async () => {
    stubApi().malformed('GET /api/digest')
    openDigest()

    expect(await screen.findByText(/The Digest didn’t load\./)).toBeDefined()
  })

  it('names a server failure plainly and offers Retry', async () => {
    stubApi().on('GET /api/digest', {
      status: 503,
      body: { error: { code: 'unavailable', message: 'Service unavailable' } },
    })
    openDigest()

    expect(await screen.findByText(/The Digest didn’t load\./)).toBeDefined()
    expect(screen.getByRole('button', { name: 'Retry' })).toBeDefined()
  })
})

const CALENDAR = {
  today: '2026-08-08',
  days: cadenceWindow({ '2026-08-08': 2, '2026-08-07': 1, '2026-08-03': 4, '2026-07-31': 2, '2026-06-03': 1 }),
  subscriptions: 1,
}

const dayDigest = (date: string, titles: readonly string[]) =>
  digest({
    groups: [digestGroup({ date: day(date), items: titles.map((title, index) => item(10 + index, title, '09:00')) })],
  })

const digestWithCalendar = () =>
  stubApi().on('GET /api/digest', { body: DIGEST }).on('GET /api/digest/days', { body: CALENDAR })

describe('the Digest from a day', () => {
  it('starts from a day picked on the calendar, and from today when today is picked', async () => {
    digestWithCalendar().on('GET /api/digest?from=2026-08-03', {
      body: dayDigest('2026-08-03', ['Four letters']),
    })
    openDigest('/digest')
    const user = userEvent.setup()

    await screen.findByRole('heading', { level: 2, name: 'Today' })
    await user.click(screen.getByRole('button', { name: 'Saturday 8 August' }))
    const days = screen.getByRole('group', { name: 'Days' })
    expect(
      within(days).getByRole('button', { name: '2 Feed Items on 8 August 2026' }).getAttribute('aria-current'),
    ).toBe('date')

    await user.click(within(days).getByRole('button', { name: '4 Feed Items on 3 August 2026' }))

    expect(window.location.search).toBe('?from=2026-08-03')
    expect(await screen.findByRole('link', { name: 'Four letters' })).toBeDefined()
    expect(screen.queryByRole('group', { name: 'Days' })).toBeNull()

    await user.click(screen.getByRole('button', { name: 'Monday 3 August' }))
    await user.click(screen.getByRole('button', { name: '2 Feed Items on 8 August 2026' }))

    expect(window.location.search).toBe('')
    expect(await screen.findByRole('link', { name: 'First light' })).toBeDefined()
  })

  it('keeps the list on show while the day it starts from loads', async () => {
    const picked = Promise.withResolvers<{ body: Digest }>()
    const api = digestWithCalendar().on('GET /api/digest?from=2026-08-03', () => picked.promise)
    openDigest('/digest')
    const user = userEvent.setup()

    await screen.findByRole('heading', { level: 2, name: 'Today' })
    await user.click(screen.getByRole('button', { name: 'Saturday 8 August' }))
    await user.click(screen.getByRole('button', { name: '4 Feed Items on 3 August 2026' }))

    await waitFor(() => expect(api.requestsTo('GET /api/digest?from=2026-08-03')).toHaveLength(1))
    expect(screen.getByRole('link', { name: 'First light' })).toBeDefined()
    expect(screen.queryByText('Loading the Digest')).toBeNull()

    picked.resolve({ body: dayDigest('2026-08-03', ['Four letters']) })
    expect(await screen.findByRole('link', { name: 'Four letters' })).toBeDefined()
    expect(screen.queryByRole('link', { name: 'First light' })).toBeNull()
  })
})
