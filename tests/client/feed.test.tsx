import { render, screen, waitFor } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App } from '../../src/client/app.js'
import { cadenceWindow as cadence } from './cadence-window.js'
import { stubApi } from './stub-api.js'

const AVAILABLE = {
  state: 'available',
  lastCheckedAt: '2026-08-08T09:00:00.000Z',
  lastSuccessAt: '2026-08-08T09:00:00.000Z',
  consecutiveFailures: 0,
  category: null,
}

const DETAIL = {
  feedId: 1,
  title: 'Field Notes',
  description: null,
  reportedTitle: 'Field Notes',
  customTitle: null,
  domain: 'journal.example',
  homePageUrl: 'https://journal.example/',
  enteredUrl: 'https://journal.example/feed',
  resolvedUrl: 'https://feeds.example/journal.xml',
  availability: AVAILABLE,
  schedule: { pollingIntervalMinutes: 120, nextPollAt: '2026-08-08T11:00:00.000Z' },
  cadence: cadence({ '2026-06-03': 2, '2026-08-08': 1 }),
  items: [
    {
      feedItemId: 12,
      title: 'First light',
      link: 'https://journal.example/first-light',
      publishedAt: '2026-08-08T07:15:00.000Z',
      firstSeenAt: '2026-08-08T09:00:00.000Z',
      date: '2026-08-08',
      displayDate: 'today, 07:15',
      saved: false,
    },
    {
      feedItemId: 11,
      title: 'A June letter',
      link: null,
      publishedAt: '2026-06-03T12:00:00.000Z',
      firstSeenAt: '2026-06-03T13:00:00.000Z',
      date: '2026-06-03',
      displayDate: '3 june',
      saved: true,
    },
  ],
}

const LIST_FEED = {
  feedId: 1,
  title: 'Field Notes',
  description: null,
  domain: DETAIL.domain,
  homePageUrl: DETAIL.homePageUrl,
  enteredUrl: DETAIL.enteredUrl,
  resolvedUrl: DETAIL.resolvedUrl,
  cadence: Array.from({ length: 30 }, () => 0),
  availability: AVAILABLE,
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('opening one Feed', () => {
  it('opens from its list row into the accepted header, grid, statistics, and retained items', async () => {
    stubApi()
      .on('GET /api/feeds', { body: { subscriptions: [LIST_FEED] } })
      .on('GET /api/feeds/1', { body: DETAIL })
    window.history.replaceState(null, '', '/feeds')
    const { container } = render(<App />)
    const user = userEvent.setup()

    await user.click(await screen.findByRole('link', { name: 'Field Notes' }))

    expect(await screen.findByRole('group', { name: /26 weeks of publishing cadence for Field Notes/i })).toBeDefined()
    expect(window.location.pathname).toBe('/feeds/1')
    expect(screen.getByRole('link', { name: /← feeds/i })).toBeDefined()
    expect(screen.getByRole('link', { name: 'journal.example' }).getAttribute('href')).toBe('https://journal.example/')
    // No Feed Description reported, so no line claims the space under the header.
    expect(container.querySelector('.feed-description')).toBeNull()

    expect(container.querySelectorAll('.cadence-cell')).toHaveLength(181)
    expect(container.querySelectorAll('.cadence-cell[data-level="2"]')).toHaveLength(1)
    const months = [...container.querySelectorAll('.cadence-month')].map((label) => label.textContent)
    expect(months).toEqual(['february', 'april', 'june', 'august'])
    expect(
      screen.getByText('3 posts in 26 weeks · busiest on wednesdays · longest quiet stretch 114 days'),
    ).toBeDefined()

    expect(screen.getByRole('heading', { name: 'First light' })).toBeDefined()
    expect(screen.getByText('today, 07:15')).toBeDefined()
    expect(screen.getByText('3 june')).toBeDefined()
    expect(screen.getByRole('button', { name: /save First light/i }).textContent).toBe('save')
    expect(screen.getByRole('button', { name: /save A June letter/i }).textContent).toBe('saved')
    for (const meta of container.querySelectorAll('.feed-items .content-meta')) {
      expect(meta.textContent).not.toContain('Field Notes')
    }
  })

  it('shows the Feed Description under the header when the Feed reports one', async () => {
    stubApi().on('GET /api/feeds/1', { body: { ...DETAIL, description: 'Notes from the field' } })
    window.history.replaceState(null, '', '/feeds/1')
    const { container } = render(<App />)

    await screen.findByRole('group', { name: /26 weeks of publishing cadence/i })
    const description = container.querySelector('.feed-description')
    expect(description?.textContent).toBe('Notes from the field')
    expect(description?.previousElementSibling?.className).toContain('feed-header')
  })

  it('saves and unsaves a retained item in place, from this Feed', async () => {
    const api = stubApi()
      .on('GET /api/feeds/1', { body: DETAIL })
      .on('PUT /api/library/12', { body: { feedItemId: 12, saved: true, savedAt: '2026-08-08T09:05:00.000Z' } })
      .on('DELETE /api/library/12', { body: { feedItemId: 12, saved: false, savedAt: null } })
    window.history.replaceState(null, '', '/feeds/1')
    render(<App />)
    const user = userEvent.setup()

    const toggle = await screen.findByRole('button', { name: /save First light/i })
    await user.click(toggle)

    await waitFor(() => expect(toggle.textContent).toBe('saved'))
    expect(toggle.getAttribute('aria-pressed')).toBe('true')
    expect(api.requestsTo('PUT /api/library/12')).toHaveLength(1)

    await user.click(toggle)

    await waitFor(() => expect(toggle.textContent).toBe('save'))
    expect(api.requestsTo('DELETE /api/library/12')).toHaveLength(1)
  })

  it('opens directly from its own address', async () => {
    stubApi().on('GET /api/feeds/1', { body: DETAIL })
    window.history.replaceState(null, '', '/feeds/1')
    render(<App />)

    expect(await screen.findByText(/3 posts in 26 weeks/)).toBeDefined()
  })

  it('goes back to the list without losing the tab', async () => {
    stubApi()
      .on('GET /api/feeds', { body: { subscriptions: [LIST_FEED] } })
      .on('GET /api/feeds/1', { body: DETAIL })
    window.history.replaceState(null, '', '/feeds/1')
    render(<App />)
    const user = userEvent.setup()

    await user.click(await screen.findByRole('link', { name: /← feeds/i }))

    expect(await screen.findByRole('textbox', { name: /search or add feeds/i })).toBeDefined()
    expect(window.location.pathname).toBe('/feeds')
  })

  it('moves focus and view to a selected day’s Feed Items, by keyboard alone', async () => {
    stubApi().on('GET /api/feeds/1', { body: DETAIL })
    window.history.replaceState(null, '', '/feeds/1')
    render(<App />)
    const user = userEvent.setup()

    const day = await screen.findByRole('button', { name: /2 posts on 3 june 2026 — show that day/i })
    day.focus()
    await user.keyboard('{Enter}')

    const anchored = document.getElementById('feed-1-day-2026-06-03')
    expect(anchored?.textContent).toContain('A June letter')
    expect(document.activeElement).toBe(anchored)
  })

  it('leaves silent days out of the keyboard order — only represented days are selectable', async () => {
    stubApi().on('GET /api/feeds/1', { body: DETAIL })
    window.history.replaceState(null, '', '/feeds/1')
    const { container } = render(<App />)

    await screen.findByText(/3 posts in 26 weeks/)
    expect(container.querySelectorAll('button.cadence-cell')).toHaveLength(2)
  })
})

describe('managing one Feed', () => {
  it('changes the Polling Interval to another preset and says so', async () => {
    const api = stubApi()
      .on('GET /api/feeds/1', { body: DETAIL })
      .on('PUT /api/feeds/1/interval', {
        body: { pollingIntervalMinutes: 360, nextPollAt: '2026-08-08T15:00:00.000Z' },
      })
    window.history.replaceState(null, '', '/feeds/1')
    render(<App />)
    const user = userEvent.setup()

    const chosen = await screen.findByRole('button', { name: /check every 2 hours/i })
    expect(chosen.getAttribute('aria-pressed')).toBe('true')
    await user.click(screen.getByRole('button', { name: /check every 6 hours/i }))

    expect(await screen.findByText('now checked every 6 hours')).toBeDefined()
    expect(screen.getByRole('button', { name: /check every 6 hours/i }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: /check every 2 hours/i }).getAttribute('aria-pressed')).toBe('false')
    expect(api.requestsTo('PUT /api/feeds/1/interval')).toMatchObject([{ body: { pollingIntervalMinutes: 360 } }])
  })

  it('refreshes by hand and shows what the attempt observed', async () => {
    const api = stubApi().on('GET /api/feeds/1', { body: DETAIL })
    api.on('POST /api/feeds/1/refresh', () => {
      api.on('GET /api/feeds/1', {
        body: { ...DETAIL, cadence: cadence({ '2026-06-03': 2, '2026-08-08': 2 }) },
      })
      return { body: { observedItems: 2 } }
    })
    window.history.replaceState(null, '', '/feeds/1')
    render(<App />)
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'refresh now' }))

    expect(await screen.findByText('refreshed — the feed shows 2 items')).toBeDefined()
    expect(await screen.findByText(/4 posts in 26 weeks/)).toBeDefined()
    expect(api.requestsTo('POST /api/feeds/1/refresh')).toHaveLength(1)
  })

  it('explains a refresh the server asked to wait on', async () => {
    stubApi()
      .on('GET /api/feeds/1', { body: DETAIL })
      .on('POST /api/feeds/1/refresh', {
        status: 429,
        headers: { 'retry-after': '42' },
        body: { error: { code: 'refresh_rate_limited', message: 'Wait before refreshing this Feed again' } },
      })
    window.history.replaceState(null, '', '/feeds/1')
    render(<App />)
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'refresh now' }))

    expect(await screen.findByText('checked a moment ago — wait a little before retrying')).toBeDefined()
  })

  it('shows calm Feed Availability while keeping the retained items readable', async () => {
    stubApi().on('GET /api/feeds/1', {
      body: {
        ...DETAIL,
        availability: {
          state: 'unavailable',
          lastCheckedAt: '2026-08-08T09:00:00.000Z',
          lastSuccessAt: '2026-08-05T09:00:00.000Z',
          consecutiveFailures: 3,
          category: 'http_error',
        },
      },
    })
    window.history.replaceState(null, '', '/feeds/1')
    render(<App />)

    expect(await screen.findByText(/the publisher is answering with an error/i)).toBeDefined()
    expect(screen.getByText(/items stay in your digest/i)).toBeDefined()
    expect(screen.getByRole('heading', { name: 'First light' })).toBeDefined()
    expect(screen.getByRole('button', { name: 'refresh now' })).toBeDefined()
  })

  it('says what unsubscribing means before doing it, and lets the User keep the Feed', async () => {
    const api = stubApi().on('GET /api/feeds/1', { body: DETAIL })
    window.history.replaceState(null, '', '/feeds/1')
    render(<App />)
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'unsubscribe' }))

    expect(screen.getByText('Removes the feed and its items except saved items.')).toBeDefined()
    expect(api.requestsTo('DELETE /api/feeds/1')).toHaveLength(0)

    await user.click(screen.getByRole('button', { name: 'cancel' }))

    expect(screen.getByRole('button', { name: 'unsubscribe' })).toBeDefined()
    expect(api.requestsTo('DELETE /api/feeds/1')).toHaveLength(0)
  })

  it('unsubscribes on the confirming word and returns to the Feeds list', async () => {
    const api = stubApi().on('GET /api/feeds/1', { body: DETAIL }).on('DELETE /api/feeds/1', { status: 204 })
    window.history.replaceState(null, '', '/feeds/1')
    render(<App />)
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'unsubscribe' }))
    await user.click(screen.getByRole('button', { name: 'confirm' }))

    expect(await screen.findByRole('textbox', { name: /search or add feeds/i })).toBeDefined()
    expect(window.location.pathname).toBe('/feeds')
    expect(api.requestsTo('DELETE /api/feeds/1')).toHaveLength(1)
  })

  it('stays on the Feed and says so when unsubscribing does not go through', async () => {
    stubApi()
      .on('GET /api/feeds/1', { body: DETAIL })
      .on('DELETE /api/feeds/1', {
        status: 503,
        body: { error: { code: 'service_unavailable', message: 'Starting' } },
      })
    window.history.replaceState(null, '', '/feeds/1')
    render(<App />)
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'unsubscribe' }))
    await user.click(screen.getByRole('button', { name: 'confirm' }))

    expect(await screen.findByText('the feed could not be unsubscribed')).toBeDefined()
    expect(window.location.pathname).toBe('/feeds/1')
    expect(screen.getByRole('button', { name: 'unsubscribe' })).toBeDefined()
  })
})

describe('the quiet states of one Feed', () => {
  it('stays calm when nothing is retained yet', async () => {
    stubApi().on('GET /api/feeds/1', { body: { ...DETAIL, cadence: cadence(), items: [] } })
    window.history.replaceState(null, '', '/feeds/1')
    const { container } = render(<App />)

    expect(await screen.findByText('no posts in 26 weeks')).toBeDefined()
    expect(screen.getByText('nothing retained from this feed yet')).toBeDefined()
    expect(container.querySelectorAll('button.cadence-cell')).toHaveLength(0)
    await waitFor(() => expect(container.textContent).not.toMatch(/unread/i))
  })

  it('says when the Feed is not among the subscriptions', async () => {
    stubApi().on('GET /api/feeds/9', {
      status: 404,
      body: { error: { code: 'not_found', message: 'Not found' } },
    })
    window.history.replaceState(null, '', '/feeds/9')
    render(<App />)

    expect(await screen.findByText('that feed is not in your subscriptions')).toBeDefined()
    expect(screen.getByRole('link', { name: /← feeds/i })).toBeDefined()
  })

  it('says when the reader cannot answer for the Feed', async () => {
    stubApi().on('GET /api/feeds/1', {
      status: 503,
      body: { error: { code: 'service_unavailable', message: 'Starting' } },
    })
    window.history.replaceState(null, '', '/feeds/1')
    render(<App />)

    expect(await screen.findByText('the feed is unavailable')).toBeDefined()
  })
})
