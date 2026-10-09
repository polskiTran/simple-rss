import { render, screen, waitFor, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App } from '../../src/client/app.js'
import { digest, searchResult } from './fixtures.js'
import { stubApi } from './stub-api.js'

const result = (feedItemId: number, title: string, displayDate: string, saved = false) =>
  searchResult({ feedItemId, title, displayDate, saved })

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('the search line in the chrome', () => {
  it('swaps the screen for results that say title, Feed, date, and saved state', async () => {
    stubApi()
      .on('GET /api/digest', { body: digest() })
      .on('GET /api/search?q=chronology', {
        body: {
          scope: 'everywhere',
          subscriptions: [],
          results: [result(9, 'Morning chronology', 'today, 07:15'), result(8, 'Tide chronology', '3 june', true)],
        },
      })
    window.history.replaceState(null, '', '/')
    render(<App />)
    const user = userEvent.setup()

    const field = await screen.findByRole('searchbox', { name: 'Search your reading' })
    await user.type(field, 'chronology')

    const results = await screen.findByRole('region', { name: 'search results' })
    expect(window.location.pathname + window.location.search).toBe('/search?q=chronology')
    expect(results.textContent).toContain('Morning chronology')
    expect(results.textContent).toContain('Field Notes')
    expect(results.textContent).toContain('today, 07:15')
    expect(screen.getByRole('button', { name: 'Save Tide chronology' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.queryByRole('heading', { name: 'Today 1' })).toBeNull()

    await user.clear(field)
    expect(await screen.findByRole('heading', { name: 'Today 1' })).toBeDefined()
    expect(screen.queryByRole('region', { name: 'search results' })).toBeNull()
    expect(window.location.pathname).toBe('/digest')
  })

  it('says while it is searching, and that nothing matched when nothing did', async () => {
    const answer = Promise.withResolvers<void>()
    stubApi()
      .on('GET /api/digest', { body: digest() })
      .on('GET /api/search?q=driftwood', async () => {
        await answer.promise
        return { body: { scope: 'everywhere', subscriptions: [], results: [] } }
      })
    window.history.replaceState(null, '', '/')
    render(<App />)
    const user = userEvent.setup()

    await user.type(await screen.findByRole('searchbox', { name: 'Search your reading' }), 'driftwood')

    expect((await screen.findByRole('status')).textContent).toBe('Searching…')
    answer.resolve()
    expect((await screen.findByText('Nothing in your reading matches “driftwood”.')).getAttribute('role')).toBe(
      'status',
    )
  })

  it('keeps the last results in view while the next search is answered', async () => {
    const answer = Promise.withResolvers<void>()
    const api = stubApi()
      .on('GET /api/digest', { body: digest() })
      .on('GET /api/search?q=drift', {
        body: { scope: 'everywhere', subscriptions: [], results: [result(9, 'Driftwood morning', 'today, 07:15')] },
      })
      .on('GET /api/search?q=driftwood', async () => {
        await answer.promise
        return { body: { scope: 'everywhere', subscriptions: [], results: [] } }
      })
    window.history.replaceState(null, '', '/')
    render(<App />)
    const user = userEvent.setup()

    const field = await screen.findByRole('searchbox', { name: 'Search your reading' })
    await user.type(field, 'drift')
    const results = await screen.findByRole('region', { name: 'search results' })

    await user.type(field, 'wood')
    await waitFor(() => expect(api.requestsTo('GET /api/search?q=driftwood')).toHaveLength(1))
    expect(results.getAttribute('aria-busy')).toBe('true')
    expect(within(results).getByRole('link', { name: 'Driftwood morning' })).toBeDefined()
    expect(screen.queryByText('Searching…')).toBeNull()

    answer.resolve()
    expect(await screen.findByText('Nothing in your reading matches “driftwood”.')).toBeDefined()
  })

  it('tells a silent network apart from a refusing server for a search too', async () => {
    const api = stubApi()
      .on('GET /api/digest', { body: digest() })
      .on('GET /api/search?q=drift', () => {
        throw new TypeError('fetch failed')
      })
    window.history.replaceState(null, '', '/')
    render(<App />)
    const user = userEvent.setup()

    const field = await screen.findByRole('searchbox', { name: 'Search your reading' })
    await user.type(field, 'drift')
    expect(await screen.findByText('Search can’t be reached. Check the connection, then try again.')).toBeDefined()

    api.on('GET /api/search?q=driftless', {
      status: 503,
      body: { error: { code: 'unavailable', message: 'Unavailable' } },
    })
    await user.type(field, 'less')
    expect(await screen.findByText('Search didn’t load. Try again in a moment.')).toBeDefined()
  })

  it('answers a shared search address with the results it names', async () => {
    stubApi()
      .on('GET /api/digest', { body: digest() })
      .on('GET /api/search?q=chronology', {
        body: { scope: 'everywhere', subscriptions: [], results: [result(9, 'Morning chronology', 'today, 07:15')] },
      })
    window.history.replaceState(null, '', '/search?q=chronology')
    render(<App />)

    const results = await screen.findByRole('region', { name: 'search results' })
    expect(results.textContent).toContain('Morning chronology')
    const field = await screen.findByRole<HTMLInputElement>('searchbox', { name: 'Search your reading' })
    expect(field.value).toBe('chronology')
  })

  it('ranks by newest on request, keeping the order in the address while the words change', async () => {
    const api = stubApi()
      .on('GET /api/search?q=chronology', {
        body: { scope: 'everywhere', subscriptions: [], results: [result(9, 'Morning chronology', 'today, 07:15')] },
      })
      .on('GET /api/search?q=chronology&sort=newest', {
        body: { scope: 'everywhere', subscriptions: [], results: [result(8, 'Tide chronology', '3 june')] },
      })
      .on('GET /api/search?q=chronology+notes&sort=newest', {
        body: { scope: 'everywhere', subscriptions: [], results: [] },
      })
    window.history.replaceState(null, '', '/search?q=chronology')
    render(<App />)
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'Newest' }))

    expect(await screen.findByRole('heading', { name: 'Tide chronology' })).toBeDefined()
    expect(window.location.search).toBe('?q=chronology&sort=newest')

    await user.type(screen.getByRole('searchbox', { name: 'Search your reading' }), ' notes')
    await waitFor(() => expect(api.requestsTo('GET /api/search?q=chronology+notes&sort=newest')).toHaveLength(1))
  })

  it('offers no ranking where the answer is Subscriptions alone', async () => {
    stubApi().on('GET /api/search?q=field&in=subscriptions', {
      body: { scope: 'subscriptions', subscriptions: [] },
    })
    window.history.replaceState(null, '', '/search?q=field&in=subscriptions')
    render(<App />)

    expect(await screen.findByText(/Nothing in/)).toBeDefined()
    expect(screen.queryByRole('button', { name: 'Newest' })).toBeNull()
  })

  it('marks the words that matched, in the title and the snippet alike', async () => {
    stubApi().on('GET /api/search?q=Tide', {
      body: {
        scope: 'everywhere',
        subscriptions: [],
        results: [{ ...result(9, 'Tide chronology', 'Today, 07:15'), snippet: 'Low tide came early.' }],
      },
    })
    window.history.replaceState(null, '', '/search?q=Tide')
    const { container } = render(<App />)

    await screen.findByRole('region', { name: 'search results' })
    const marks = [...container.querySelectorAll('mark.match')].map((mark) => mark.textContent)
    expect(marks).toEqual(['Tide', 'tide'])
    expect(screen.getByRole('link', { name: 'Tide chronology' })).toBeDefined()
  })

  it('narrows the results to the ticked Feeds, and clears back to all of them', async () => {
    stubApi().on('GET /api/search?q=light', {
      body: {
        scope: 'everywhere',
        subscriptions: [],
        results: [
          result(9, 'Morning light', 'Today, 07:15'),
          result(8, 'Evening light', 'Today, 06:00'),
          { ...result(7, 'Coast light', '3 June'), feedId: 2, feedTitle: 'The Slow Press' },
        ],
      },
    })
    window.history.replaceState(null, '', '/search?q=light')
    render(<App />)
    const user = userEvent.setup()

    const filter = await screen.findByRole('complementary', { name: 'Narrow by feed' })
    expect(within(filter).getByRole('checkbox', { name: 'Field Notes 2' })).toBeDefined()

    await user.click(within(filter).getByRole('checkbox', { name: 'The Slow Press 1' }))

    const results = screen.getByRole('region', { name: 'search results' })
    expect(
      within(results)
        .getAllByRole('article')
        .map((item) => item.querySelector('h3')?.textContent),
    ).toEqual(['Coast light'])

    await user.click(within(filter).getByRole('button', { name: 'Clear' }))

    expect(within(results).getAllByRole('article')).toHaveLength(3)
  })
})
