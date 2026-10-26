import { render, screen, waitFor, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App } from '../../src/client/app.js'
import { cadenceWindow as cadence } from './cadence-window.js'
import { availability, feedDetail, feedItemRow, feedItems, subscription } from './fixtures.js'
import { stubApi } from './stub-api.js'

const DETAIL = feedDetail({
  subscribedDate: '2026-05-20',
  cadence: cadence({ '2026-06-03': 2, '2026-08-08': 1 }),
})

const JUNE_LETTER = feedItemRow({
  feedItemId: 11,
  title: 'A June letter',
  link: null,
  publishedAt: '2026-06-03T12:00:00.000Z',
  firstSeenAt: '2026-06-03T13:00:00.000Z',
  date: '2026-06-03',
  displayTime: '12:00',
  saved: true,
})

const ITEMS = feedItems({ items: [feedItemRow({ feedItemId: 12 }), JUNE_LETTER] })

/** Today's page alone, with June waiting behind Show more. */
const TODAY_ONLY = feedItems({ items: [feedItemRow({ feedItemId: 12 })], nextFrom: '2026-06-03' })

function feedApi(items = ITEMS) {
  return stubApi().on('GET /api/feeds/1', { body: DETAIL }).on('GET /api/feeds/1/items', { body: items })
}

const LIST_FEED = subscription({ subscribedAt: '2026-05-20T09:00:00.000Z' })

afterEach(() => {
  vi.unstubAllGlobals()
})

function infoValue(label: string): string | null | undefined {
  return screen.getByText(label).nextElementSibling?.textContent
}

describe('opening one Feed', () => {
  it('opens from its list row into the accepted header, grid, statistics, and retained items', async () => {
    feedApi().on('GET /api/feeds', { body: { subscriptions: [LIST_FEED] } })
    window.history.replaceState(null, '', '/feeds')
    const { container } = render(<App />)
    const user = userEvent.setup()

    await user.click(await screen.findByRole('link', { name: 'Field Notes' }))

    expect(await screen.findByRole('group', { name: /26 weeks of Cadence for Field Notes/i })).toBeDefined()
    expect(window.location.pathname).toBe('/feeds/1')
    expect(within(screen.getByRole('main')).getByRole('link', { name: 'Back to Feeds' })).toBeDefined()
    expect(screen.getByRole('link', { name: 'journal.example (opens in a new tab)' }).getAttribute('href')).toBe(
      'https://journal.example/',
    )
    expect(container.querySelector('.feed-description')).toBeNull()

    expect(container.querySelectorAll('.cadence-grid .cadence-cell')).toHaveLength(181)
    expect(container.querySelectorAll('.cadence-grid .cadence-cell[data-level="2"]')).toHaveLength(1)
    const months = [...container.querySelectorAll('.cadence-month')].map((label) => label.textContent)
    expect(months).toEqual(['Feb', 'Apr', 'Jun', 'Aug'])
    expect(infoValue('Subscribed')).toBe('20 May')
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
    feedApi().on('GET /api/feeds/1', { body: { ...DETAIL, description: 'Notes from the field' } })
    window.history.replaceState(null, '', '/feeds/1')
    const { container } = render(<App />)

    await screen.findByRole('group', { name: /26 weeks of Cadence/i })
    const description = container.querySelector('.feed-description')
    expect(description?.textContent).toBe('Notes from the field')
    expect(description?.previousElementSibling?.className).toContain('page-title')
  })

  it('saves and unsaves a retained item in place, from this Feed', async () => {
    const api = feedApi()
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
    feedApi()
    window.history.replaceState(null, '', '/feeds/1')
    render(<App />)

    expect(await screen.findByRole('group', { name: /26 weeks of Cadence/i })).toBeDefined()
  })

  it('goes back to the list without losing the tab', async () => {
    feedApi().on('GET /api/feeds', { body: { subscriptions: [LIST_FEED] } })
    window.history.replaceState(null, '', '/feeds/1')
    render(<App />)
    const user = userEvent.setup()

    await user.click(await within(screen.getByRole('main')).findByRole('link', { name: 'Back to Feeds' }))

    expect(await screen.findByRole('heading', { level: 1, name: /^Feeds/ })).toBeDefined()
    expect(window.location.pathname).toBe('/feeds')
  })

  it('moves focus and view to a selected day’s Feed Items, by keyboard alone', async () => {
    feedApi()
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

  it('shows the next older days on Show more, and stops where the Feed ends', async () => {
    const api = feedApi(TODAY_ONLY).on('GET /api/feeds/1/items?from=2026-06-03', {
      body: feedItems({ items: [JUNE_LETTER] }),
    })
    window.history.replaceState(null, '', '/feeds/1')
    render(<App />)
    const user = userEvent.setup()

    await screen.findByRole('heading', { name: 'First light' })
    expect(screen.queryByRole('heading', { name: 'A June letter' })).toBeNull()

    await user.click(screen.getByRole('button', { name: 'Show more' }))

    expect(await screen.findByRole('heading', { name: 'A June letter' })).toBeDefined()
    expect(screen.getByRole('heading', { name: 'First light' })).toBeDefined()
    expect(screen.queryByRole('button', { name: 'Show more' })).toBeNull()
    expect(api.requestsTo('GET /api/feeds/1/items?from=2026-06-03')).toHaveLength(1)
  })

  it('fetches a day picked on the grid that is not shown yet, then moves to it', async () => {
    const api = feedApi(TODAY_ONLY).on('GET /api/feeds/1/items?from=2026-06-03&through=2026-06-03', {
      body: feedItems({ items: [JUNE_LETTER] }),
    })
    window.history.replaceState(null, '', '/feeds/1')
    render(<App />)
    const user = userEvent.setup()

    await screen.findByRole('heading', { name: 'First light' })
    await user.click(screen.getByRole('button', { name: /2 items on 3 June 2026, show that day/i }))

    await waitFor(() =>
      expect(document.activeElement).toBe(document.getElementById('feed-1-day-2026-06-03')?.closest('section')),
    )
    expect(document.activeElement?.textContent).toContain('A June letter')
    expect(api.requestsTo('GET /api/feeds/1/items?from=2026-06-03&through=2026-06-03')).toHaveLength(1)
  })

  it('leaves silent days out of the keyboard order — only represented days are selectable', async () => {
    feedApi()
    window.history.replaceState(null, '', '/feeds/1')
    const { container } = render(<App />)

    await screen.findByRole('group', { name: /26 weeks of Cadence/i })
    expect(container.querySelectorAll('button.cadence-cell')).toHaveLength(2)
  })
})

describe('managing one Feed', () => {
  it('changes the Polling Interval to another preset', async () => {
    const api = feedApi().on('PUT /api/feeds/1/interval', {
      body: { pollingIntervalMinutes: 360, nextPollAt: '2026-08-08T15:00:00.000Z' },
    })
    window.history.replaceState(null, '', '/feeds/1')
    render(<App />)
    const user = userEvent.setup()

    const select = await screen.findByRole<HTMLSelectElement>('combobox', { name: 'Check every' })
    expect(select.value).toBe('120')
    await user.selectOptions(select, '6 hours')

    await waitFor(() => expect(select.value).toBe('360'))
    expect(api.requestsTo('PUT /api/feeds/1/interval')).toMatchObject([{ body: { pollingIntervalMinutes: 360 } }])
  })

  it('refreshes by hand and shows what the attempt observed', async () => {
    const api = feedApi()
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
    feedApi().on('POST /api/feeds/1/refresh', {
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
    feedApi().on('GET /api/feeds/1', {
      body: {
        ...DETAIL,
        availability: availability({
          state: 'unavailable',
          lastSuccessDate: '2026-08-05',
          consecutiveFailures: 3,
          category: 'http_error',
        }),
      },
    })
    window.history.replaceState(null, '', '/feeds/1')
    render(<App />)

    expect(await screen.findByText(/the publisher is answering with an error/i)).toBeDefined()
    expect(screen.getByText(/last reached/i)).toBeDefined()
    expect(screen.getByRole('heading', { name: 'First light' })).toBeDefined()
    expect(screen.getByRole('button', { name: 'Refresh now' })).toBeDefined()
  })

  it('says what unsubscribing means before doing it, and lets the User keep the Feed', async () => {
    const api = feedApi()
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
    const api = feedApi().on('DELETE /api/feeds/1', { status: 204 })
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
    feedApi().on('DELETE /api/feeds/1', {
      status: 503,
      body: { error: { code: 'unavailable', message: 'Starting' } },
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
    feedApi(feedItems({ items: [] })).on('GET /api/feeds/1', { body: { ...DETAIL, cadence: cadence() } })
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
      body: { error: { code: 'unavailable', message: 'Starting' } },
    })
    window.history.replaceState(null, '', '/feeds/1')
    render(<App />)

    expect(await screen.findByText('The feed didn’t load.')).toBeDefined()
  })
})

describe('moving from one Feed to the next', () => {
  it('shows nothing of the feed just left while the next one loads', async () => {
    const next = Promise.withResolvers<{ body: ReturnType<typeof feedDetail> }>()
    stubApi()
      .on('GET /api/feeds/2', {
        body: feedDetail({
          feedId: 2,
          title: 'Other Wire',
          domain: 'wire.example',
          homePageUrl: 'https://wire.example/',
        }),
      })
      .on('GET /api/feeds/2/items', {
        body: feedItems({ items: [feedItemRow({ feedItemId: 8, title: 'Second light' })] }),
      })
      .on('GET /api/feeds/1', () => next.promise)
      .on('GET /api/feeds/1/items', () => new Promise(() => {}))
    window.history.replaceState(null, '', '/feeds/1')
    window.history.pushState(null, '', '/feeds/2')
    render(<App />)

    expect(await screen.findByRole('heading', { level: 1, name: 'Other Wire' })).toBeDefined()
    expect(screen.getByRole('heading', { name: 'Second light' })).toBeDefined()

    window.history.back()

    expect(await screen.findByText('Loading the feed')).toBeDefined()
    expect(screen.queryByText('Other Wire')).toBeNull()
    expect(screen.queryByText('Second light')).toBeNull()
    expect(screen.queryByText('wire.example')).toBeNull()

    next.resolve({
      body: feedDetail({
        feedId: 1,
        title: 'Morning Wire',
        domain: 'morning.example',
        homePageUrl: 'https://morning.example/',
      }),
    })

    expect(await screen.findByRole('heading', { level: 1, name: 'Morning Wire' })).toBeDefined()
    expect(screen.getByText('Loading the items')).toBeDefined()
    expect(screen.queryByText('Other Wire')).toBeNull()
    expect(screen.queryByText('Second light')).toBeNull()
    expect(screen.queryByText('wire.example')).toBeNull()
  })
})
