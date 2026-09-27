import { render, screen, waitFor, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App } from '../../src/client/app.js'
import { cadenceWindow } from './cadence-window.js'
import { stubApi } from './stub-api.js'

const item = (feedItemId: number, title: string, displayTime: string) => ({
  feedItemId,
  title,
  feedId: 1,
  feedTitle: 'Field Notes',
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
      count: 2,
      items: [item(3, 'First light', '07:15'), item(2, 'Second thoughts', '06:40')],
    },
    { date: '2026-08-07', label: 'Yesterday', count: 1, items: [item(1, 'Evening notes', '09:31')] },
    { date: '2026-06-03', label: 'Wednesday 3 June', count: 1, items: [item(4, 'A June letter', '12:00')] },
  ],
  nextCursor: null,
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
    expect(screen.getByText('Saturday 8 August')).toBeDefined()
    expect(screen.getByText('Friday 7 August')).toBeDefined()

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

  it('counts a day in full even when the page holds only part of it', async () => {
    const [today] = DIGEST.groups
    stubApi().on('GET /api/digest', { body: { ...DIGEST, groups: [{ ...today, count: 60 }], nextCursor: 'more' } })
    window.history.replaceState(null, '', '/')
    render(<App />)

    expect(await screen.findByRole('heading', { name: 'Today 60' })).toBeDefined()
    expect(screen.getByRole('button', { name: 'Show more' })).toBeDefined()
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

  it('leads to Add feed before any Subscription, with no Rhythms or Days to choose from', async () => {
    stubApi().on('GET /api/digest/days', { body: { today: '2026-08-08', days: cadenceWindow(), subscriptions: 0 } })
    window.history.replaceState(null, '', '/')
    render(<App />)

    expect(await screen.findByText('Nothing yet. Subscribe to a feed to start your digest.')).toBeDefined()
    expect(screen.getByRole('button', { name: 'Add feed' })).toBeDefined()
    expect(screen.queryByRole('group', { name: 'Rhythm' })).toBeNull()
    expect(screen.queryByRole('navigation', { name: 'Days' })).toBeNull()
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

const DAY = {
  date: '2026-08-07',
  feeds: [
    { feedId: 1, title: 'Field Notes', count: 3 },
    { feedId: 2, title: 'Weekly Letters', count: 1 },
  ],
}

const dayDigest = (date: string, label: string, titles: readonly string[]) => ({
  today: '2026-08-08',
  groups: [
    {
      date,
      label,
      count: titles.length,
      items: titles.map((title, index) => item(10 + index, title, '09:00')),
    },
  ],
  nextCursor: null,
})

const digestWithCalendar = () =>
  stubApi().on('GET /api/digest', { body: DIGEST }).on('GET /api/digest/days', { body: CALENDAR })

describe('the Digest read three ways', () => {
  it('names the last week beside All items, each day a way into it', async () => {
    digestWithCalendar()
      .on('GET /api/digest?day=2026-08-07', { body: dayDigest('2026-08-07', 'Yesterday', ['Evening notes']) })
      .on('GET /api/digest/days/2026-08-07', { body: DAY })
    window.history.replaceState(null, '', '/digest')
    render(<App />)
    const user = userEvent.setup()

    const days = await screen.findByRole('navigation', { name: 'Days' })
    expect(
      within(days)
        .getAllByRole('link')
        .map((day) => day.textContent),
    ).toEqual(['Today2', 'Yesterday1', 'Thu 6 Aug0', 'Wed 5 Aug0', 'Tue 4 Aug0', 'Mon 3 Aug4', 'Sun 2 Aug0'])

    await user.click(within(days).getByRole('link', { name: /^Yesterday/ }))

    expect(window.location.search).toBe('?by=day&day=2026-08-07')
    expect(await screen.findByRole('heading', { name: 'Yesterday 1' })).toBeDefined()
  })

  it('narrows All items to the Feeds of one Rhythm, and says when none of them published', async () => {
    const api = digestWithCalendar().on('GET /api/digest?rhythm=inactive', {
      body: { today: '2026-08-08', groups: [], nextCursor: null },
    })
    window.history.replaceState(null, '', '/digest')
    render(<App />)
    const user = userEvent.setup()

    await screen.findByRole('heading', { name: 'Today 2' })
    await user.click(within(screen.getByRole('group', { name: 'Rhythm' })).getByRole('button', { name: 'Inactive' }))

    expect(await screen.findByText('Nothing from inactive feeds.')).toBeDefined()
    expect(window.location.search).toBe('?rhythm=inactive')
    expect(api.requestsTo('GET /api/digest?rhythm=inactive')).toHaveLength(1)
  })

  it('shows one day under the calendar, steps between days, and never past today', async () => {
    digestWithCalendar()
      .on('GET /api/digest?day=2026-08-08', { body: dayDigest('2026-08-08', 'Today', ['First light', 'Second']) })
      .on('GET /api/digest/days/2026-08-08', { body: { date: '2026-08-08', feeds: [DAY.feeds[0]] } })
      .on('GET /api/digest?day=2026-08-07', { body: dayDigest('2026-08-07', 'Yesterday', ['Evening notes']) })
      .on('GET /api/digest/days/2026-08-07', { body: DAY })
    window.history.replaceState(null, '', '/digest')
    render(<App />)
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'By day' }))

    expect(window.location.search).toBe('?by=day')
    expect(await screen.findByRole('heading', { name: 'Today 2' })).toBeDefined()
    expect(fact('Day')).toBe('Saturday 8 August')
    expect(fact('Last 26 weeks')).toBe('8 items')
    expect(screen.getByRole('button', { name: 'Next day' }).getAttribute('aria-disabled')).toBe('true')

    await user.click(screen.getByRole('button', { name: 'Previous day' }))

    expect(window.location.search).toBe('?by=day&day=2026-08-07')
    expect(await screen.findByRole('heading', { name: 'Yesterday 1' })).toBeDefined()
    expect(await screen.findByText('Weekly Letters')).toBeDefined()
    expect(fact('Items')).toBe('4')
    expect(fact('Feeds')).toBe('2')

    await user.click(screen.getByRole('button', { name: '4 items on 3 August 2026, show that day' }))
    expect(window.location.search).toBe('?by=day&day=2026-08-03')
  })

  it('narrows a day to the Feeds ticked beside it, and Clear shows all of it again', async () => {
    const api = digestWithCalendar()
      .on('GET /api/digest?day=2026-08-07', {
        body: dayDigest('2026-08-07', 'Yesterday', ['Evening notes', 'A letter']),
      })
      .on('GET /api/digest?day=2026-08-07&feed=2', { body: dayDigest('2026-08-07', 'Yesterday', ['A letter']) })
      .on('GET /api/digest/days/2026-08-07', { body: DAY })
    window.history.replaceState(null, '', '/digest?by=day&day=2026-08-07')
    render(<App />)
    const user = userEvent.setup()

    const filter = await screen.findByRole('complementary', { name: 'Narrow by feed' })
    await user.click(within(filter).getByRole('checkbox', { name: /Weekly Letters/ }))

    await waitFor(() => expect(screen.queryByText('Evening notes')).toBeNull())
    expect(api.requestsTo('GET /api/digest?day=2026-08-07&feed=2')).toHaveLength(1)

    await user.click(within(filter).getByRole('button', { name: 'Clear' }))
    expect(await screen.findByText('Evening notes')).toBeDefined()
  })

  it('gives each Feed a card of its newest items, dated as briefly as the distance allows', async () => {
    const row = (feedItemId: number, title: string, date: string, displayTime: string) => ({
      feedItemId,
      title,
      link: null,
      publishedAt: `${date}T${displayTime}:00.000Z`,
      firstSeenAt: `${date}T${displayTime}:00.000Z`,
      date,
      displayTime,
      saved: false,
    })
    digestWithCalendar().on('GET /api/digest/feeds', {
      body: {
        today: '2026-08-08',
        feeds: [
          {
            feedId: 1,
            title: 'Field Notes',
            description: null,
            domain: 'journal.example',
            homePageUrl: 'https://journal.example/',
            enteredUrl: 'https://journal.example/feed',
            resolvedUrl: 'https://journal.example/feed',
            readingSource: 'original-webpage',
            subscribedAt: '2026-01-01T00:00:00.000Z',
            cadence: Array.from({ length: 30 }, () => 0),
            availability: {
              state: 'available',
              lastCheckedAt: null,
              lastSuccessAt: null,
              consecutiveFailures: 0,
              category: null,
            },
            items: [
              row(3, 'First light', '2026-08-08', '07:15'),
              row(2, 'Evening notes', '2026-08-07', '21:00'),
              row(1, 'Monday thoughts', '2026-08-03', '09:00'),
            ],
          },
        ],
      },
    })
    window.history.replaceState(null, '', '/digest?by=feed')
    render(<App />)

    const card = await screen.findByRole('region', { name: 'Field Notes' })
    expect(within(card).getByRole('link', { name: 'Field Notes' }).getAttribute('href')).toBe('/feeds/1')
    expect(within(card).getByRole('link', { name: 'journal.example' })).toBeDefined()
    expect(
      within(card)
        .getAllByRole('listitem')
        .map((entry) => entry.textContent),
    ).toEqual(['First light07:15', 'Evening notesYesterday', 'Monday thoughtsMon'])
  })
})

function fact(label: string): string | null | undefined {
  return screen.getByText(label, { selector: 'dt' }).nextElementSibling?.textContent
}
