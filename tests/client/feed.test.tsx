import { render, screen, waitFor, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { afterEach, describe, expect, expectTypeOf, it, vi } from 'vitest'
import type { fetchFeedItems } from '../../src/client/api.js'
import { App } from '../../src/client/app.js'
import { cadenceWindow as cadence } from './cadence-window.js'
import { day, feedDetail, feedItemRow, feedItems, subscription, unavailable } from './fixtures.js'
import { stubApi } from './stub-api.js'

const DETAIL = feedDetail({
  subscribedDate: day('2026-05-20'),
  cadence: cadence({ '2026-06-03': 2, '2026-08-08': 1 }),
})

const JUNE_LETTER = feedItemRow({
  feedItemId: 11,
  title: 'A June letter',
  link: null,
  publishedAt: '2026-06-03T12:00:00.000Z',
  firstSeenAt: '2026-06-03T13:00:00.000Z',
  date: day('2026-06-03'),
  displayTime: '12:00',
  saved: true,
})

const ITEMS = feedItems({ items: [feedItemRow({ feedItemId: 12 }), JUNE_LETTER] })

const TODAY_ONLY = feedItems({ items: [feedItemRow({ feedItemId: 12 })], nextFrom: day('2026-06-03') })

function feedApi(items = ITEMS) {
  return stubApi().on('GET /api/feeds/1', { body: DETAIL }).on('GET /api/feeds/1/items', { body: items })
}

const LIST_FEED = subscription({ subscribedAt: '2026-05-20T09:00:00.000Z' })

afterEach(() => {
  vi.unstubAllGlobals()
})

function row(label: string): HTMLElement {
  const cell = screen.getByText(label, { selector: '.x-c-label' })
  const ledgerRow = cell.closest<HTMLElement>('.x-ledger-row')
  if (!ledgerRow) throw new Error(`no ledger row labelled ${label}`)
  return ledgerRow
}

function openFeed(path = '/feeds/1') {
  window.history.replaceState(null, '', path)
  return render(<App />)
}

describe('opening one Feed', () => {
  it('opens from the Feeds list into its ledger, Cadence and retained Feed Items by day', async () => {
    feedApi().on('GET /api/feeds', { body: { subscriptions: [LIST_FEED] } })
    window.history.replaceState(null, '', '/feeds')
    const { container } = render(<App />)
    const user = userEvent.setup()

    await user.click(await screen.findByRole('link', { name: 'Field Notes' }))

    const grid = await screen.findByRole('group', { name: '26 weeks of Cadence for Field Notes' })
    expect(window.location.pathname).toBe('/feeds/1')
    expect(screen.getByRole('heading', { level: 1, name: 'Field Notes' })).toBeDefined()
    const home = within(row('Home page')).getByRole('link', { name: 'journal.example' })
    expect(home.getAttribute('href')).toBe('https://journal.example/')
    expect(home.getAttribute('rel')).toBe('noopener noreferrer')
    expect(screen.queryByText('Description', { selector: '.x-c-label' })).toBeNull()
    expect(within(row('Subscribed')).getByText('20 May')).toBeDefined()
    expect(within(grid).getAllByRole('button')).toHaveLength(2)

    expect(screen.getByRole('heading', { level: 2, name: 'Today' })).toBeDefined()
    expect(screen.getByRole('heading', { level: 2, name: 'Wednesday 3 June' })).toBeDefined()
    expect(screen.getByRole('link', { name: 'First light' })).toBeDefined()
    expect(screen.getByText('07:15')).toBeDefined()
    expect(screen.getByRole('button', { name: 'Save First light' }).getAttribute('aria-pressed')).toBe('false')
    expect(screen.getByRole('button', { name: 'Saved A June letter' }).getAttribute('aria-pressed')).toBe('true')
    expect(container.querySelector('.x-plain')?.textContent).not.toContain('Field Notes')
  })

  it('shows the Feed Description in its row when the Feed reports one', async () => {
    feedApi().on('GET /api/feeds/1', { body: { ...DETAIL, description: 'Notes from the field' } })
    openFeed()

    await screen.findByRole('group', { name: /26 weeks of Cadence/ })
    expect(within(row('Description')).getByText('Notes from the field')).toBeDefined()
  })

  it('saves and unsaves a retained Feed Item in place, from this Feed', async () => {
    const api = feedApi()
      .on('PUT /api/library/12', { body: { feedItemId: 12, saved: true, savedAt: '2026-08-08T09:05:00.000Z' } })
      .on('DELETE /api/library/12', { body: { feedItemId: 12, saved: false, savedAt: null } })
    openFeed()
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'Save First light' }))

    expect(await screen.findByRole('button', { name: 'Saved First light', pressed: true })).toBeDefined()
    expect(api.requestsTo('PUT /api/library/12')).toHaveLength(1)

    await user.click(screen.getByRole('button', { name: 'Saved First light' }))

    expect(await screen.findByRole('button', { name: 'Save First light', pressed: false })).toBeDefined()
    expect(api.requestsTo('DELETE /api/library/12')).toHaveLength(1)
  })

  it('shows no time for a Feed Item on a Release Date', async () => {
    feedApi(
      feedItems({
        items: [feedItemRow({ feedItemId: 12, publishedAt: '2026-08-08T00:00:00.000Z', displayTime: null })],
      }),
    )
    openFeed()

    const item = (await screen.findByRole('link', { name: 'First light' })).closest('.x-row')
    expect(item?.textContent).not.toMatch(/\d\d:\d\d/)
  })

  it('brings a day picked on the Cadence into view and moves focus to it, by keyboard alone', async () => {
    feedApi()
    openFeed()
    const user = userEvent.setup()

    const picked = await screen.findByRole('button', { name: /2 Feed Items on 3 June 2026, show that day/i })
    picked.focus()
    await user.keyboard('{Enter}')

    const section = screen.getByRole('region', { name: 'Wednesday 3 June' })
    expect(section.textContent).toContain('A June letter')
    expect(document.activeElement).toBe(section)
  })

  it('shows the next older days on request, and stops where the Feed ends', async () => {
    const api = feedApi(TODAY_ONLY).on('GET /api/feeds/1/items?from=2026-06-03', {
      body: feedItems({ items: [JUNE_LETTER] }),
    })
    openFeed()
    const user = userEvent.setup()

    await screen.findByRole('link', { name: 'First light' })
    expect(screen.queryByRole('link', { name: 'A June letter' })).toBeNull()

    await user.click(screen.getByRole('button', { name: 'Show older days' }))

    expect(await screen.findByRole('link', { name: 'A June letter' })).toBeDefined()
    expect(screen.getByRole('link', { name: 'First light' })).toBeDefined()
    expect(screen.queryByRole('button', { name: 'Show older days' })).toBeNull()
    expect(api.requestsTo('GET /api/feeds/1/items?from=2026-06-03')).toHaveLength(1)
  })

  it('pages a Feed by DigestStart, never by a hand-built query string', () => {
    expectTypeOf<string>().not.toMatchTypeOf<Parameters<typeof fetchFeedItems>[1]>()
  })

  it('fetches a day picked on the Cadence that is not shown yet, then moves to it', async () => {
    const api = feedApi(TODAY_ONLY).on('GET /api/feeds/1/items?from=2026-06-03&through=2026-06-03', {
      body: feedItems({ items: [JUNE_LETTER] }),
    })
    openFeed()
    const user = userEvent.setup()

    await screen.findByRole('link', { name: 'First light' })
    await user.click(screen.getByRole('button', { name: /2 Feed Items on 3 June 2026, show that day/i }))

    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('region', { name: 'Wednesday 3 June' })))
    expect(document.activeElement?.textContent).toContain('A June letter')
    expect(api.requestsTo('GET /api/feeds/1/items?from=2026-06-03&through=2026-06-03')).toHaveLength(1)
  })
})

describe('managing one Feed', () => {
  it('changes the Polling Interval to another preset', async () => {
    const api = feedApi().on('PUT /api/feeds/1/interval', {
      body: { pollingIntervalMinutes: 360, nextPollAt: '2026-08-08T15:00:00.000Z' },
    })
    openFeed()
    const user = userEvent.setup()

    const choice = await screen.findByRole('group', { name: 'Polling interval' })
    expect(within(choice).getByRole('button', { name: '2 hours' }).getAttribute('aria-pressed')).toBe('true')
    await user.click(within(choice).getByRole('button', { name: '6 hours' }))

    await waitFor(() =>
      expect(within(choice).getByRole('button', { name: '6 hours' }).getAttribute('aria-pressed')).toBe('true'),
    )
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
    openFeed()
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'Refresh now' }))

    expect(await screen.findByText('Refreshed. The Feed shows 2 Feed Items.')).toBeDefined()
    expect(api.requestsTo('POST /api/feeds/1/refresh')).toHaveLength(1)
  })

  it('shows calm Feed Availability while keeping the retained Feed Items readable', async () => {
    feedApi().on('GET /api/feeds/1', { body: { ...DETAIL, availability: unavailable() } })
    openFeed()

    expect(await screen.findByText(/the publisher is answering with an error/i)).toBeDefined()
    expect(screen.getByText(/last reached/i)).toBeDefined()
    expect(screen.getByRole('link', { name: 'First light' })).toBeDefined()
    expect(screen.getByRole('button', { name: 'Refresh now' })).toBeDefined()
  })

  it('says what unsubscribing means before doing it, and lets the User keep the Feed', async () => {
    const api = feedApi()
    openFeed()
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'Unsubscribe' }))

    expect(screen.getByText('Its Feed Items leave the Digest. Saved ones stay in the Library.')).toBeDefined()
    expect(api.requestsTo('DELETE /api/feeds/1')).toHaveLength(0)

    await user.click(screen.getByRole('button', { name: 'Unsubscribe', expanded: true }))

    expect(screen.queryByRole('button', { name: 'Unsubscribe from Field Notes' })).toBeNull()
    expect(api.requestsTo('DELETE /api/feeds/1')).toHaveLength(0)
  })

  it('unsubscribes on the confirming press and returns to the Feeds list', async () => {
    const api = feedApi().on('DELETE /api/feeds/1', { status: 204 })
    openFeed()
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'Unsubscribe' }))
    await user.click(screen.getByRole('button', { name: 'Unsubscribe from Field Notes' }))

    await waitFor(() => expect(window.location.pathname).toBe('/feeds'))
    expect(api.requestsTo('DELETE /api/feeds/1')).toHaveLength(1)
  })

  it('stays on the Feed and says so when unsubscribing does not go through', async () => {
    feedApi().on('DELETE /api/feeds/1', {
      status: 503,
      body: { error: { code: 'unavailable', message: 'Starting' } },
    })
    openFeed()
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'Unsubscribe' }))
    await user.click(screen.getByRole('button', { name: 'Unsubscribe from Field Notes' }))

    expect(await screen.findByText('The Feed couldn’t be unsubscribed.')).toBeDefined()
    expect(window.location.pathname).toBe('/feeds/1')
    expect(screen.getByRole('button', { name: 'Unsubscribe' })).toBeDefined()
  })
})

describe('the quiet states of one Feed', () => {
  it('stays calm when nothing is retained yet', async () => {
    feedApi(feedItems({ items: [] })).on('GET /api/feeds/1', { body: { ...DETAIL, cadence: cadence() } })
    const { container } = openFeed()

    expect(await screen.findByText('Nothing retained from this Feed yet.')).toBeDefined()
    expect(within(screen.getByRole('group', { name: /26 weeks of Cadence/ })).queryAllByRole('button')).toHaveLength(0)
    expect(container.textContent).not.toMatch(/unread/i)
  })

  it('says when the Feed is not among the Subscriptions', async () => {
    stubApi().on('GET /api/feeds/9', {
      status: 404,
      body: { error: { code: 'not_found', message: 'Not found' } },
    })
    openFeed('/feeds/9')

    expect(await screen.findByText('That Feed isn’t among your Subscriptions.')).toBeDefined()
  })

  it('says when the reader cannot answer for the Feed', async () => {
    stubApi().on('GET /api/feeds/1', {
      status: 503,
      body: { error: { code: 'unavailable', message: 'Starting' } },
    })
    openFeed()

    expect(await screen.findByText(/The Feed didn’t load\./)).toBeDefined()
  })
})

describe('moving from one Feed to the next', () => {
  it('shows nothing of the Feed just left while the next one loads', async () => {
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
    expect(screen.getByRole('link', { name: 'Second light' })).toBeDefined()

    window.history.back()

    expect(await screen.findByText('Loading the Feed')).toBeDefined()
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
    expect(screen.getByText('Loading the Feed Items')).toBeDefined()
    expect(screen.queryByText('Second light')).toBeNull()
    expect(screen.queryByText('wire.example')).toBeNull()
  })
})
