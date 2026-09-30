import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App } from '../../src/client/app.js'
import { cadenceWindow } from './cadence-window.js'
import { stubApi } from './stub-api.js'

const item = (feedItemId: number, title: string, displayTime: string, feedId = 1, feedTitle = 'Field Notes') => ({
  feedItemId,
  title,
  feedId,
  feedTitle,
  link: `https://journal.example/${feedItemId}`,
  publishedAt: '2026-08-08T07:15:00.000Z',
  displayTime,
  imageUrl: null,
  summary: null,
  firstSeenAt: '2026-08-08T09:00:00.000Z',
  saved: false,
})

const DIGEST = {
  today: '2026-08-08',
  groups: [
    {
      date: '2026-08-08',
      label: 'Today',
      items: [item(3, 'First light', '07:15'), item(2, 'Second thoughts', '06:40')],
      returns: [],
    },
    { date: '2026-08-07', label: 'Yesterday', items: [item(1, 'Evening notes', '09:31')], returns: [] },
    { date: '2026-06-03', label: 'Wednesday 3 June', items: [item(4, 'A June letter', '12:00')], returns: [] },
  ],
  nextFrom: null,
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('the chronological Digest', () => {
  it('titles the page with today and heads each day with its count', async () => {
    stubApi().on('GET /api/digest', { body: DIGEST })
    window.history.replaceState(null, '', '/')
    const { container } = render(<App />)

    expect(await screen.findByRole('heading', { level: 1, name: 'Digest Sat 8 Aug' })).toBeDefined()
    expect(screen.getByRole('heading', { name: 'Today 2' })).toBeDefined()
    expect(screen.getByRole('heading', { name: 'Yesterday 1' })).toBeDefined()
    expect(screen.getByRole('heading', { name: 'Wednesday 3 June 1' })).toBeDefined()
    expect(within(screen.getByRole('region', { name: 'Today 2' })).getByText('Saturday 8 August')).toBeDefined()
    expect(within(screen.getByRole('region', { name: 'Yesterday 1' })).getByText('Friday 7 August')).toBeDefined()

    const [first] = screen.getAllByRole('article')
    expect(
      within(first as HTMLElement)
        .getByRole('link', { name: 'Field Notes' })
        .getAttribute('href'),
    ).toBe('/feeds/1')
    expect(within(first as HTMLElement).getByText('07:15')).toBeDefined()
    expect(screen.getByRole('button', { name: 'Save First light' }).getAttribute('aria-pressed')).toBe('false')
    expect(container.textContent).not.toMatch(/unread|mark|archive/i)
  })

  it('shows more from the day the page names, under the days already shown', async () => {
    const [today, yesterday, june] = DIGEST.groups
    const api = stubApi()
      .on('GET /api/digest', { body: { ...DIGEST, groups: [today, yesterday], nextFrom: '2026-06-03' } })
      .on('GET /api/digest?from=2026-06-03', { body: { ...DIGEST, groups: [june] } })
    window.history.replaceState(null, '', '/')
    render(<App />)
    const user = userEvent.setup()

    await screen.findByRole('heading', { name: 'Yesterday 1' })
    await user.click(screen.getByRole('button', { name: 'Show more' }))

    expect(await screen.findByRole('heading', { name: 'Wednesday 3 June 1' })).toBeDefined()
    expect(screen.getByRole('heading', { name: 'Today 2' })).toBeDefined()
    expect(api.requestsTo('GET /api/digest?from=2026-06-03')).toHaveLength(1)
    expect(screen.queryByRole('button', { name: 'Show more' })).toBeNull()
  })

  it('shows a Feed past five items in a day folded to its newest three, unfolds it, and folds it again', async () => {
    const titles = ['One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven']
    stubApi().on('GET /api/digest', {
      body: {
        ...DIGEST,
        groups: [
          {
            date: '2026-08-08',
            label: 'Today',
            items: titles.map((title, index) => item(20 - index, title, `0${9 - index}:00`)),
            returns: [],
          },
        ],
      },
    })
    window.history.replaceState(null, '', '/')
    render(<App />)
    const user = userEvent.setup()

    const box = await screen.findByRole('article')
    expect(within(box).getByText('7 items')).toBeDefined()
    expect(within(box).getByText('03:00–09:00')).toBeDefined()
    expect(
      within(box)
        .getAllByRole('heading')
        .map((title) => title.textContent),
    ).toEqual(['One', 'Two', 'Three'])

    await user.click(within(box).getByRole('button', { name: 'Show 4 more' }))

    expect(
      within(box)
        .getAllByRole('heading')
        .map((title) => title.textContent),
    ).toEqual(titles)

    const less = within(box).getByRole('button', { name: 'Show less' })
    await user.click(less)

    expect(within(box).getAllByRole('heading')).toHaveLength(3)
    expect(document.activeElement).toBe(within(box).getByRole('button', { name: 'Show 4 more' }))
  })

  it('shows one Feed of the day alone while its chip is pressed', async () => {
    stubApi().on('GET /api/digest', {
      body: {
        ...DIGEST,
        groups: [
          {
            date: '2026-08-08',
            label: 'Today',
            items: [item(3, 'First light', '07:15'), item(5, 'A letter', '06:00', 2, 'Letters')],
            returns: [],
          },
        ],
      },
    })
    window.history.replaceState(null, '', '/')
    render(<App />)
    const user = userEvent.setup()

    const chips = await screen.findByRole('group', { name: 'Feeds on Saturday 8 August' })
    expect(within(chips).getByText('2 feeds')).toBeDefined()
    const letters = within(chips).getByRole('button', { name: 'Letters 1' })

    await user.click(letters)
    expect(screen.getAllByRole('article').map((box) => within(box).getByRole('heading').textContent)).toEqual([
      'A letter',
    ])

    await user.click(letters)
    expect(screen.getAllByRole('article')).toHaveLength(2)
  })

  it('says when a Feed is back after a quiet spell', async () => {
    const [today] = DIGEST.groups
    stubApi().on('GET /api/digest', {
      body: {
        ...DIGEST,
        groups: [
          {
            date: '2026-08-08',
            label: 'Today',
            items: [item(5, 'A letter', '06:00', 2, 'Letters'), ...(today?.items ?? [])],
            returns: [
              {
                feedId: 2,
                quietDays: 12,
                cadence: Array.from({ length: 30 }, (_, day) => (day === 17 || day === 29 ? 1 : 0)),
              },
            ],
          },
        ],
      },
    })
    window.history.replaceState(null, '', '/')
    render(<App />)

    const [back, other] = await screen.findAllByRole('article')
    expect(within(back as HTMLElement).getByText('First item in 12 days')).toBeDefined()
    expect(within(other as HTMLElement).queryByText(/^First item in/)).toBeNull()
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

  it('leads to Add feed before any Subscription, with no days to choose from', async () => {
    stubApi().on('GET /api/digest/days', { body: { today: '2026-08-08', days: cadenceWindow(), subscriptions: 0 } })
    window.history.replaceState(null, '', '/')
    render(<App />)

    expect(await screen.findByText('Nothing yet. Subscribe to a feed to start your digest.')).toBeDefined()
    expect(screen.getByRole('button', { name: 'Add feed' })).toBeDefined()
    expect(screen.queryByRole('region', { name: 'August 2026' })).toBeNull()
    expect(screen.queryByLabelText('Start from a day')).toBeNull()
  })

  it('says items are on their way when Subscriptions have yet to publish', async () => {
    stubApi()
    window.history.replaceState(null, '', '/')
    render(<App />)

    expect(await screen.findByText('Nothing yet. Items arrive here as your feeds publish.')).toBeDefined()
    expect(screen.queryByRole('button', { name: 'Add feed' })).toBeNull()
  })

  it('tells a silent network apart from a refusing server, and offers the way back', async () => {
    const api = stubApi().on('GET /api/digest', () => {
      throw new TypeError('fetch failed')
    })
    window.history.replaceState(null, '', '/')
    render(<App />)
    const user = userEvent.setup()

    expect(await screen.findByText('The digest can’t be reached. Check the connection, then try again.')).toBeDefined()

    api.on('GET /api/digest', { body: DIGEST })
    await user.click(screen.getByRole('button', { name: 'Retry' }))

    expect(await screen.findByRole('heading', { name: 'Today 2' })).toBeDefined()
  })

  it('blames the reader, not the connection, when the answer fails its schema', async () => {
    stubApi().on('GET /api/digest', { body: { unexpected: true } })
    window.history.replaceState(null, '', '/')
    render(<App />)

    expect(await screen.findByText('The digest didn’t load. Try again in a moment.')).toBeDefined()
  })

  it('names a server failure without dressing it up', async () => {
    stubApi().on('GET /api/digest', {
      status: 503,
      body: { error: { code: 'unavailable', message: 'Service unavailable' } },
    })
    window.history.replaceState(null, '', '/')
    render(<App />)

    expect(await screen.findByText('The digest didn’t load. Try again in a moment.')).toBeDefined()
    expect(screen.getByRole('button', { name: 'Retry' })).toBeDefined()
  })
})

const CALENDAR = {
  today: '2026-08-08',
  days: cadenceWindow({ '2026-08-08': 2, '2026-08-07': 1, '2026-08-03': 4, '2026-06-03': 1 }),
  subscriptions: 1,
}

const dayDigest = (date: string, label: string, titles: readonly string[]) => ({
  today: '2026-08-08',
  groups: [
    {
      date,
      label,
      items: titles.map((title, index) => item(10 + index, title, '09:00')),
      returns: [],
    },
  ],
  nextFrom: null,
})

const digestWithCalendar = () =>
  stubApi().on('GET /api/digest', { body: DIGEST }).on('GET /api/digest/days', { body: CALENDAR })

describe('the Digest from a day', () => {
  it('starts from a day picked on the month, and goes back to today', async () => {
    digestWithCalendar().on('GET /api/digest?from=2026-08-03', {
      body: dayDigest('2026-08-03', 'Monday 3 August', ['Four letters']),
    })
    window.history.replaceState(null, '', '/digest')
    render(<App />)
    const user = userEvent.setup()

    const month = await screen.findByRole('region', { name: 'August 2026' })
    await screen.findByRole('heading', { name: 'Today 2' })
    expect(within(month).getByText('Saturday 8 August').nextSibling?.textContent).toBe('2 items')
    expect(screen.queryByRole('button', { name: 'Back to today' })).toBeNull()

    const monday = within(month).getByRole('button', { name: '4 items on 3 August 2026' })
    await user.click(monday)

    expect(window.location.search).toBe('?from=2026-08-03')
    expect(await screen.findByRole('heading', { name: 'Monday 3 August 1' })).toBeDefined()
    expect(monday.getAttribute('aria-pressed')).toBe('true')
    expect(within(month).getByText('Monday 3 August').nextSibling?.textContent).toBe('4 items')

    await user.click(screen.getByRole('button', { name: 'Back to today' }))

    expect(window.location.search).toBe('')
    expect(await screen.findByRole('heading', { name: 'Today 2' })).toBeDefined()
    expect(screen.queryByRole('button', { name: 'Back to today' })).toBeNull()
  })

  it('starts from a day chosen in the date picker, and from today when today is chosen', async () => {
    digestWithCalendar().on('GET /api/digest?from=2026-08-07', {
      body: dayDigest('2026-08-07', 'Yesterday', ['Evening notes']),
    })
    window.history.replaceState(null, '', '/digest')
    render(<App />)

    const picker = await screen.findByLabelText('Start from a day')
    expect(picker.getAttribute('max')).toBe('2026-08-08')

    fireEvent.change(picker, { target: { value: '2026-08-07' } })
    expect(window.location.search).toBe('?from=2026-08-07')
    expect(await screen.findByRole('heading', { name: 'Yesterday 1' })).toBeDefined()

    fireEvent.change(picker, { target: { value: '2026-08-08' } })
    expect(window.location.search).toBe('')
  })

  it('keeps the list on show while the day it starts from loads', async () => {
    const picked = Promise.withResolvers<{ body: ReturnType<typeof dayDigest> }>()
    const api = digestWithCalendar().on('GET /api/digest?from=2026-08-03', () => picked.promise)
    window.history.replaceState(null, '', '/digest')
    render(<App />)
    const user = userEvent.setup()

    await screen.findByRole('heading', { name: 'Today 2' })
    await user.click(screen.getByRole('button', { name: '4 items on 3 August 2026' }))

    await waitFor(() => expect(api.requestsTo('GET /api/digest?from=2026-08-03')).toHaveLength(1))
    expect(screen.getByText('First light')).toBeDefined()
    expect(screen.queryByText('Loading the digest')).toBeNull()

    picked.resolve({ body: dayDigest('2026-08-03', 'Monday 3 August', ['Four letters']) })
    expect(await screen.findByText('Four letters')).toBeDefined()
    expect(screen.queryByText('First light')).toBeNull()
  })
})
