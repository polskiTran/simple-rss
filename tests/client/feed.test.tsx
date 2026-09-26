import { render, screen, waitFor, within } from '@testing-library/react'
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
  reportedDescription: null,
  customDescription: null,
  domain: 'journal.example',
  homePageUrl: 'https://journal.example/',
  enteredUrl: 'https://journal.example/feed',
  resolvedUrl: 'https://feeds.example/journal.xml',
  availability: AVAILABLE,
  schedule: { pollingIntervalMinutes: 120, nextPollAt: '2026-08-08T11:00:00.000Z' },
  readingSource: 'original-webpage',
  cadence: cadence({ '2026-06-03': 2, '2026-08-08': 1 }),
  items: [
    {
      feedItemId: 12,
      title: 'First light',
      link: 'https://journal.example/first-light',
      publishedAt: '2026-08-08T07:15:00.000Z',
      firstSeenAt: '2026-08-08T09:00:00.000Z',
      date: '2026-08-08',
      displayTime: '07:15',
      saved: false,
    },
    {
      feedItemId: 11,
      title: 'A June letter',
      link: null,
      publishedAt: '2026-06-03T12:00:00.000Z',
      firstSeenAt: '2026-06-03T13:00:00.000Z',
      date: '2026-06-03',
      displayTime: '12:00',
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
  readingSource: 'original-webpage',
  cadence: Array.from({ length: 30 }, () => 0),
  availability: AVAILABLE,
}

afterEach(() => {
  vi.unstubAllGlobals()
})

/** The value beside a label in the Feed's Info panel. */
function infoValue(label: string): string | null | undefined {
  return screen.getByText(label).nextElementSibling?.textContent
}

describe('opening one Feed', () => {
  it('opens from its list row into the accepted header, grid, statistics, and retained items', async () => {
    stubApi()
      .on('GET /api/feeds', { body: { subscriptions: [LIST_FEED] } })
      .on('GET /api/feeds/1', { body: DETAIL })
    window.history.replaceState(null, '', '/feeds')
    const { container } = render(<App />)
    const user = userEvent.setup()

    await user.click(await screen.findByRole('link', { name: 'Field Notes' }))

    expect(await screen.findByRole('group', { name: /26 weeks of Cadence for Field Notes/i })).toBeDefined()
    expect(window.location.pathname).toBe('/feeds/1')
    expect(within(screen.getByRole('main')).getByRole('link', { name: 'Back to Feeds' })).toBeDefined()
    expect(screen.getByRole('link', { name: 'journal.example' }).getAttribute('href')).toBe('https://journal.example/')
    expect(container.querySelector('.feed-description')).toBeNull()

    expect(container.querySelectorAll('.cadence-grid .cadence-cell')).toHaveLength(181)
    expect(container.querySelectorAll('.cadence-grid .cadence-cell[data-level="2"]')).toHaveLength(1)
    const months = [...container.querySelectorAll('.cadence-month')].map((label) => label.textContent)
    expect(months).toEqual(['Feb', 'Apr', 'Jun', 'Aug'])
    expect(infoValue('Items, last 26 weeks')).toBe('3')
    expect(infoValue('Busiest day')).toBe('Wednesday')
    expect(infoValue('Longest quiet stretch')).toBe('114 days')

    expect(screen.getByRole('heading', { name: 'First light' })).toBeDefined()
    expect(screen.getByRole('heading', { name: 'Today 1' })).toBeDefined()
    expect(screen.getByRole('heading', { name: 'Wednesday 3 June 1' })).toBeDefined()
    expect(screen.getByText('07:15')).toBeDefined()
    expect(screen.getByRole('button', { name: /save First light/i }).getAttribute('aria-pressed')).toBe('false')
    expect(screen.getByRole('button', { name: /save A June letter/i }).getAttribute('aria-pressed')).toBe('true')
    for (const meta of container.querySelectorAll('.feed-items .item-meta')) {
      expect(meta.textContent).not.toContain('Field Notes')
    }
  })

  it('shows the Feed Description under the header when the Feed reports one', async () => {
    stubApi().on('GET /api/feeds/1', { body: { ...DETAIL, description: 'Notes from the field' } })
    window.history.replaceState(null, '', '/feeds/1')
    const { container } = render(<App />)

    await screen.findByRole('group', { name: /26 weeks of Cadence/i })
    const description = container.querySelector('.feed-description')
    expect(description?.textContent).toBe('Notes from the field')
    expect(description?.previousElementSibling?.className).toContain('page-title')
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

    await waitFor(() => expect(toggle.getAttribute('aria-pressed')).toBe('true'))
    expect(toggle.getAttribute('aria-pressed')).toBe('true')
    expect(api.requestsTo('PUT /api/library/12')).toHaveLength(1)

    await user.click(toggle)

    await waitFor(() => expect(toggle.getAttribute('aria-pressed')).toBe('false'))
    expect(api.requestsTo('DELETE /api/library/12')).toHaveLength(1)
  })

  it('opens directly from its own address', async () => {
    stubApi().on('GET /api/feeds/1', { body: DETAIL })
    window.history.replaceState(null, '', '/feeds/1')
    render(<App />)

    expect(await screen.findByRole('group', { name: /26 weeks of Cadence/i })).toBeDefined()
  })

  it('goes back to the list without losing the tab', async () => {
    stubApi()
      .on('GET /api/feeds', { body: { subscriptions: [LIST_FEED] } })
      .on('GET /api/feeds/1', { body: DETAIL })
    window.history.replaceState(null, '', '/feeds/1')
    render(<App />)
    const user = userEvent.setup()

    await user.click(await within(screen.getByRole('main')).findByRole('link', { name: 'Back to Feeds' }))

    expect(await screen.findByRole('heading', { level: 1, name: /^Feeds/ })).toBeDefined()
    expect(window.location.pathname).toBe('/feeds')
  })

  it('moves focus and view to a selected day’s Feed Items, by keyboard alone', async () => {
    stubApi().on('GET /api/feeds/1', { body: DETAIL })
    window.history.replaceState(null, '', '/feeds/1')
    render(<App />)
    const user = userEvent.setup()

    const day = await screen.findByRole('button', { name: /2 items on 3 June 2026, show that day/i })
    day.focus()
    await user.keyboard('{Enter}')

    const anchored = document.getElementById('feed-1-day-2026-06-03')?.closest('section')
    expect(anchored?.textContent).toContain('A June letter')
    expect(document.activeElement).toBe(anchored)
  })

  it('leaves silent days out of the keyboard order — only represented days are selectable', async () => {
    stubApi().on('GET /api/feeds/1', { body: DETAIL })
    window.history.replaceState(null, '', '/feeds/1')
    const { container } = render(<App />)

    await screen.findByRole('group', { name: /26 weeks of Cadence/i })
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

    const select = await screen.findByRole<HTMLSelectElement>('combobox', { name: 'Check every' })
    expect(select.value).toBe('120')
    await user.selectOptions(select, '6 hours')

    expect(await screen.findByText('Now checked every 6 hours.')).toBeDefined()
    expect(select.value).toBe('360')
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

    await user.click(await screen.findByRole('button', { name: 'Refresh now' }))

    expect(await screen.findByText('Refreshed. The feed shows 2 items.')).toBeDefined()
    await waitFor(() => expect(infoValue('Items, last 26 weeks')).toBe('4'))
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

    await user.click(await screen.findByRole('button', { name: 'Refresh now' }))

    expect(await screen.findByText('Checked a moment ago. Wait a little before retrying.')).toBeDefined()
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
    expect(screen.getByRole('button', { name: 'Refresh now' })).toBeDefined()
  })

  it('says what unsubscribing means before doing it, and lets the User keep the Feed', async () => {
    const api = stubApi().on('GET /api/feeds/1', { body: DETAIL })
    window.history.replaceState(null, '', '/feeds/1')
    render(<App />)
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'Unsubscribe' }))

    expect(screen.getByText('Its items leave your digest. Saved items stay in Saved.')).toBeDefined()
    expect(api.requestsTo('DELETE /api/feeds/1')).toHaveLength(0)

    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(screen.getByRole('button', { name: 'Unsubscribe' })).toBeDefined()
    expect(api.requestsTo('DELETE /api/feeds/1')).toHaveLength(0)
  })

  it('unsubscribes on the confirming word and returns to the Feeds list', async () => {
    const api = stubApi().on('GET /api/feeds/1', { body: DETAIL }).on('DELETE /api/feeds/1', { status: 204 })
    window.history.replaceState(null, '', '/feeds/1')
    render(<App />)
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'Unsubscribe' }))
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Unsubscribe' }))

    expect(await screen.findByRole('heading', { level: 1, name: /^Feeds/ })).toBeDefined()
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

    await user.click(await screen.findByRole('button', { name: 'Unsubscribe' }))
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Unsubscribe' }))

    expect(await screen.findByText('The feed couldn’t be unsubscribed.')).toBeDefined()
    expect(window.location.pathname).toBe('/feeds/1')
    expect(screen.getByRole('button', { name: 'Unsubscribe' })).toBeDefined()
  })
})

describe('the quiet states of one Feed', () => {
  it('stays calm when nothing is retained yet', async () => {
    stubApi().on('GET /api/feeds/1', { body: { ...DETAIL, cadence: cadence(), items: [] } })
    window.history.replaceState(null, '', '/feeds/1')
    const { container } = render(<App />)

    expect(await screen.findByText('Nothing retained from this feed yet.')).toBeDefined()
    expect(infoValue('Items, last 26 weeks')).toBe('0')
    expect(infoValue('Busiest day')).toBe('None yet')
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

    expect(await screen.findByText('That feed isn’t among your subscriptions.')).toBeDefined()
    expect(within(screen.getByRole('main')).getByRole('link', { name: 'Back to Feeds' })).toBeDefined()
  })

  it('says when the reader cannot answer for the Feed', async () => {
    stubApi().on('GET /api/feeds/1', {
      status: 503,
      body: { error: { code: 'service_unavailable', message: 'Starting' } },
    })
    window.history.replaceState(null, '', '/feeds/1')
    render(<App />)

    expect(await screen.findByText('The feed is unavailable. Try again in a moment.')).toBeDefined()
  })
})
