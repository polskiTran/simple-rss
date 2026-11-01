import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App } from '../../src/client/app.js'
import { cadenceWindow } from './cadence-window.js'
import type { Digest } from '../../src/shared/api.js'
import { digest, digestGroup, digestItem } from './fixtures.js'
import { stubApi } from './stub-api.js'

const item = (feedItemId: number, title: string, displayTime: string, feedId = 1, feedTitle = 'Field Notes') =>
  digestItem({ feedItemId, title, displayTime, feedId, feedTitle, link: `https://journal.example/${feedItemId}` })

const TODAY = digestGroup({ items: [item(3, 'First light', '07:15'), item(2, 'Second thoughts', '06:40')] })
const YESTERDAY = digestGroup({ date: '2026-08-07', items: [item(1, 'Evening notes', '09:31')] })
const JUNE = digestGroup({ date: '2026-06-03', items: [item(4, 'A June letter', '12:00')] })

const DIGEST = digest({ groups: [TODAY, YESTERDAY, JUNE] })

// A day heading's number and month are joined by a non-breaking space.
const TODAY_HEADING = 'Today Saturday 8\u00a0August 2'
const YESTERDAY_HEADING = 'Yesterday Friday 7\u00a0August 1'
const JUNE_HEADING = '2 months ago Wednesday 3\u00a0June 1'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('the chronological Digest', () => {
  it('keeps its title for screen readers and heads each day with its distance, date and count', async () => {
    stubApi().on('GET /api/digest', { body: DIGEST })
    window.history.replaceState(null, '', '/')
    const { container } = render(<App />)

    expect(await screen.findByRole('heading', { name: TODAY_HEADING })).toBeDefined()
    expect(screen.getByRole('heading', { level: 1, name: 'Digest' }).className).toBe('visually-hidden')
    expect(screen.getByRole('heading', { name: YESTERDAY_HEADING })).toBeDefined()
    expect(screen.getByRole('heading', { name: JUNE_HEADING })).toBeDefined()

    const [first] = screen.getAllByRole('article')
    expect(
      within(first as HTMLElement)
        .getByRole('link', { name: 'Field Notes' })
        .getAttribute('href'),
    ).toBe('/feeds/1')
    expect(within(first as HTMLElement).queryByText('07:15')).toBeNull()
    expect(screen.getByRole('button', { name: 'Save First light' }).getAttribute('aria-pressed')).toBe('false')
    expect(container.textContent).not.toMatch(/unread|mark|archive/i)
  })

  it('shows more from the day the page names, under the days already shown', async () => {
    const api = stubApi()
      .on('GET /api/digest', { body: digest({ groups: [TODAY, YESTERDAY], nextFrom: '2026-06-03' }) })
      .on('GET /api/digest?from=2026-06-03', { body: digest({ groups: [JUNE] }) })
    window.history.replaceState(null, '', '/')
    render(<App />)
    const user = userEvent.setup()

    await screen.findByRole('heading', { name: YESTERDAY_HEADING })
    await user.click(screen.getByRole('button', { name: 'Show more' }))

    expect(await screen.findByRole('heading', { name: JUNE_HEADING })).toBeDefined()
    expect(screen.getByRole('heading', { name: TODAY_HEADING })).toBeDefined()
    expect(api.requestsTo('GET /api/digest?from=2026-06-03')).toHaveLength(1)
    expect(screen.queryByRole('button', { name: 'Show more' })).toBeNull()
  })

  it('shows a Feed past five items in a day folded to its newest three, unfolds it, and folds it again', async () => {
    const titles = ['One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven']
    stubApi().on('GET /api/digest', {
      body: digest({
        groups: [digestGroup({ items: titles.map((title, index) => item(20 - index, title, `0${9 - index}:00`)) })],
      }),
    })
    window.history.replaceState(null, '', '/')
    render(<App />)
    const user = userEvent.setup()

    const box = await screen.findByRole('article')
    expect(within(box).getByText('7 items')).toBeDefined()
    expect(
      within(box)
        .getAllByRole('heading')
        .map((title) => title.textContent),
    ).toEqual(['One', 'Two', 'Three'])

    await user.click(within(box).getByRole('button', { name: 'Show all' }))

    expect(
      within(box)
        .getAllByRole('heading')
        .map((title) => title.textContent),
    ).toEqual(titles)

    const less = within(box).getByRole('button', { name: 'Show less' })
    await user.click(less)

    expect(within(box).getAllByRole('heading')).toHaveLength(3)
    expect(document.activeElement).toBe(within(box).getByRole('button', { name: 'Show all' }))
  })

  it('shows one Feed of the day alone while its chip is pressed', async () => {
    stubApi().on('GET /api/digest', {
      body: digest({
        groups: [digestGroup({ items: [item(3, 'First light', '07:15'), item(5, 'A letter', '06:00', 2, 'Letters')] })],
      }),
    })
    window.history.replaceState(null, '', '/')
    render(<App />)
    const user = userEvent.setup()

    const chips = await screen.findByRole('group', { name: 'Feeds on Saturday 8 August' })
    const letters = within(chips).getByRole('button', { name: 'Letters 1' })

    await user.click(letters)
    expect(screen.getAllByRole('article').map((box) => within(box).getByRole('heading').textContent)).toEqual([
      'A letter',
    ])

    await user.click(letters)
    expect(screen.getAllByRole('article')).toHaveLength(2)
  })

  it('says when a Feed is back after a quiet spell', async () => {
    stubApi().on('GET /api/digest', {
      body: digest({
        groups: [
          digestGroup({
            items: [item(5, 'A letter', '06:00', 2, 'Letters'), ...TODAY.items],
            returns: [{ feedId: 2, quietDays: 12 }],
          }),
        ],
      }),
    })
    window.history.replaceState(null, '', '/')
    render(<App />)

    const [back, other] = await screen.findAllByRole('article')
    expect(within(back as HTMLElement).getByText('First in 12 days')).toBeDefined()
    expect(within(other as HTMLElement).queryByText(/^First in/)).toBeNull()
  })

  it('names a saved title as saved', async () => {
    stubApi().on('GET /api/digest', {
      body: digest({ groups: [digestGroup({ items: [{ ...item(3, 'First light', '07:15'), saved: true }] })] }),
    })
    window.history.replaceState(null, '', '/')
    render(<App />)

    expect(await screen.findByRole('heading', { name: 'Saved: First light' })).toBeDefined()
    expect(screen.getByRole('button', { name: 'Saved First light' }).getAttribute('aria-pressed')).toBe('true')
  })

  it('flips save to saved in place once the server confirms, and back', async () => {
    const api = stubApi()
      .on('GET /api/digest', { body: DIGEST })
      .on('PUT /api/library/3', { body: { feedItemId: 3, saved: true, savedAt: '2026-08-08T09:05:00.000Z' } })
      .on('DELETE /api/library/3', { body: { feedItemId: 3, saved: false, savedAt: null } })
    window.history.replaceState(null, '', '/')
    render(<App />)
    const user = userEvent.setup()

    const toggle = await screen.findByRole('button', { name: 'Save First light' })
    await user.click(toggle)

    await waitFor(() => expect(toggle.getAttribute('aria-pressed')).toBe('true'))
    expect(toggle.getAttribute('aria-pressed')).toBe('true')
    expect(api.requestsTo('PUT /api/library/3')).toHaveLength(1)

    await user.click(toggle)

    await waitFor(() => expect(toggle.getAttribute('aria-pressed')).toBe('false'))
    expect(toggle.getAttribute('aria-pressed')).toBe('false')
    expect(api.requestsTo('DELETE /api/library/3')).toHaveLength(1)
  })

  it('keeps saying save when the server refuses the save', async () => {
    stubApi()
      .on('GET /api/digest', { body: DIGEST })
      .on('PUT /api/library/3', { status: 503, body: { error: { code: 'unavailable', message: 'Unavailable' } } })
    window.history.replaceState(null, '', '/')
    render(<App />)
    const user = userEvent.setup()

    const toggle = await screen.findByRole('button', { name: 'Save First light' })
    await user.click(toggle)

    await waitFor(() => expect(toggle.getAttribute('aria-pressed')).toBe('false'))
    expect(toggle.getAttribute('aria-pressed')).toBe('false')
  })

  it('names a day an item was placed ahead of today as tomorrow', async () => {
    const ahead = digestGroup({ date: '2026-08-09', items: [item(5, 'Early release', '08:00')] })
    stubApi().on('GET /api/digest', { body: digest({ groups: [ahead, TODAY] }) })
    window.history.replaceState(null, '', '/')
    render(<App />)

    expect(await screen.findByRole('heading', { name: 'Tomorrow Sunday 9\u00a0August 1' })).toBeDefined()
  })

  it('leads to Add feed before any Subscription, with no days to choose from', async () => {
    stubApi().on('GET /api/digest/days', { body: { today: '2026-08-08', days: cadenceWindow(), subscriptions: 0 } })
    window.history.replaceState(null, '', '/')
    render(<App />)

    expect(await screen.findByText('No feeds yet.')).toBeDefined()
    expect(screen.getByRole('button', { name: 'Add feed' })).toBeDefined()
    expect(screen.queryByRole('region', { name: 'August 2026' })).toBeNull()
    expect(screen.queryByLabelText('Start from a day')).toBeNull()
  })

  it('shows its title before any Subscription, with no date to stand for it', async () => {
    stubApi().on('GET /api/digest/days', { body: { today: '2026-08-08', days: cadenceWindow(), subscriptions: 0 } })
    window.history.replaceState(null, '', '/')
    render(<App />)

    await screen.findByText('No feeds yet.')
    expect(screen.getByRole('heading', { level: 1, name: 'Digest' }).className).toBe('page-title')
  })

  it('says items are on their way when Subscriptions have yet to publish', async () => {
    stubApi()
    window.history.replaceState(null, '', '/')
    render(<App />)

    expect(await screen.findByText('Nothing yet.')).toBeDefined()
    expect(screen.queryByRole('button', { name: 'Add feed' })).toBeNull()
  })

  it('counts a request that ran out of time as unreached', async () => {
    stubApi().on('GET /api/digest', () => {
      throw new DOMException('The operation timed out', 'TimeoutError')
    })
    window.history.replaceState(null, '', '/')
    render(<App />)

    expect(await screen.findByText('The digest can’t be reached.')).toBeDefined()
  })

  it('blames the reader, not the connection, when the answer fails its schema', async () => {
    stubApi().malformed('GET /api/digest')
    window.history.replaceState(null, '', '/')
    render(<App />)

    expect(await screen.findByText('The digest didn’t load.')).toBeDefined()
  })

  it('names a server failure without dressing it up', async () => {
    stubApi().on('GET /api/digest', {
      status: 503,
      body: { error: { code: 'unavailable', message: 'Service unavailable' } },
    })
    window.history.replaceState(null, '', '/')
    render(<App />)

    expect(await screen.findByText('The digest didn’t load.')).toBeDefined()
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
    groups: [digestGroup({ date, items: titles.map((title, index) => item(10 + index, title, '09:00')) })],
  })

const digestWithCalendar = () =>
  stubApi().on('GET /api/digest', { body: DIGEST }).on('GET /api/digest/days', { body: CALENDAR })

describe('the Digest from a day', () => {
  it('starts from a day picked on the month, and goes back to today', async () => {
    digestWithCalendar().on('GET /api/digest?from=2026-08-03', {
      body: dayDigest('2026-08-03', ['Four letters']),
    })
    window.history.replaceState(null, '', '/digest')
    render(<App />)
    const user = userEvent.setup()

    const month = await screen.findByRole('region', { name: 'August 2026' })
    await screen.findByRole('heading', { name: TODAY_HEADING })
    expect(within(month).getByRole('button', { name: '2 items on 8 August 2026' }).getAttribute('aria-pressed')).toBe(
      'true',
    )
    expect(screen.queryByRole('button', { name: 'Back to today' })).toBeNull()

    const monday = within(month).getByRole('button', { name: '4 items on 3 August 2026' })
    await user.click(monday)

    expect(window.location.search).toBe('?from=2026-08-03')
    expect(await screen.findByRole('heading', { name: '5 days ago Monday 3\u00a0August 1' })).toBeDefined()
    expect(monday.getAttribute('aria-pressed')).toBe('true')

    await user.click(screen.getByRole('button', { name: 'Back to today' }))

    expect(window.location.search).toBe('')
    expect(await screen.findByRole('heading', { name: TODAY_HEADING })).toBeDefined()
    expect(screen.queryByRole('button', { name: 'Back to today' })).toBeNull()
  })

  it('draws the days of the months either side as plain numbers, picked in their own month', async () => {
    digestWithCalendar()
    window.history.replaceState(null, '', '/digest')
    render(<App />)
    const user = userEvent.setup()

    const august = await screen.findByRole('region', { name: 'August 2026' })
    expect(within(august).queryByRole('button', { name: '2 items on 31 July 2026' })).toBeNull()

    await user.click(within(august).getByRole('button', { name: 'Previous month' }))

    const july = await screen.findByRole('region', { name: 'July 2026' })
    expect(within(july).getByRole('button', { name: '2 items on 31 July 2026' })).toBeDefined()
  })

  it('starts from a day chosen in the date picker, and from today when today is chosen', async () => {
    digestWithCalendar().on('GET /api/digest?from=2026-08-07', {
      body: dayDigest('2026-08-07', ['Evening notes']),
    })
    window.history.replaceState(null, '', '/digest')
    render(<App />)

    const picker = await screen.findByLabelText('Start from a day')
    expect(picker.getAttribute('max')).toBe('2026-08-08')

    fireEvent.change(picker, { target: { value: '2026-08-07' } })
    expect(window.location.search).toBe('?from=2026-08-07')
    expect(await screen.findByRole('heading', { name: YESTERDAY_HEADING })).toBeDefined()

    fireEvent.change(picker, { target: { value: '2026-08-08' } })
    expect(window.location.search).toBe('')
  })

  it('asks the platform for its date picker when the calendar button is clicked', async () => {
    // jsdom has no picker; a desktop browser opens one only when asked.
    const showPicker = vi.fn()
    Object.defineProperty(HTMLInputElement.prototype, 'showPicker', { value: showPicker, configurable: true })
    digestWithCalendar()
    window.history.replaceState(null, '', '/digest')
    render(<App />)

    await userEvent.setup().click(await screen.findByLabelText('Start from a day'))
    Reflect.deleteProperty(HTMLInputElement.prototype, 'showPicker')
    expect(showPicker).toHaveBeenCalledOnce()
  })

  it('keeps the list on show while the day it starts from loads', async () => {
    const picked = Promise.withResolvers<{ body: Digest }>()
    const api = digestWithCalendar().on('GET /api/digest?from=2026-08-03', () => picked.promise)
    window.history.replaceState(null, '', '/digest')
    render(<App />)
    const user = userEvent.setup()

    await screen.findByRole('heading', { name: TODAY_HEADING })
    await user.click(screen.getByRole('button', { name: '4 items on 3 August 2026' }))

    await waitFor(() => expect(api.requestsTo('GET /api/digest?from=2026-08-03')).toHaveLength(1))
    expect(screen.getByText('First light')).toBeDefined()
    expect(screen.queryByText('Loading the digest')).toBeNull()

    picked.resolve({ body: dayDigest('2026-08-03', ['Four letters']) })
    expect(await screen.findByText('Four letters')).toBeDefined()
    expect(screen.queryByText('First light')).toBeNull()
  })
})
