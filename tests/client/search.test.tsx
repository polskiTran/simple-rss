import { render, screen, waitFor, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App } from '../../src/client/app.js'
import { stubApi } from './stub-api.js'

const DIGEST = {
  today: { date: '2026-08-08', volume: 1 },
  groups: [
    {
      date: '2026-08-08',
      label: 'today',
      items: [
        {
          feedItemId: 3,
          title: 'First light',
          feedId: 1,
          feedTitle: 'Field Notes',
          link: 'https://journal.example/first-light',
          publishedAt: '2026-08-08T07:15:00.000Z',
          displayTime: '07:15',
          imageUrl: null,
          summary: null,
          firstSeenAt: '2026-08-08T09:00:00.000Z',
          saved: false,
        },
      ],
    },
  ],
  nextCursor: null,
}

const result = (feedItemId: number, title: string, displayDate: string, saved = false) => ({
  feedItemId,
  title,
  feedId: 1,
  feedTitle: 'Field Notes',
  publishedAt: '2026-08-08T07:15:00.000Z',
  firstSeenAt: '2026-08-08T09:00:00.000Z',
  displayDate,
  saved,
  snippet: null,
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('the search line in the chrome', () => {
  it('swaps the screen for results that say title, Feed, date, and saved state', async () => {
    stubApi()
      .on('GET /api/digest', { body: DIGEST })
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

    const field = await screen.findByRole('searchbox', { name: 'search your reading' })
    await user.type(field, 'chronology')

    const results = await screen.findByRole('region', { name: 'search results' })
    expect(window.location.pathname + window.location.search).toBe('/search?q=chronology')
    expect(results.textContent).toContain('Morning chronology')
    expect(results.textContent).toContain('Field Notes')
    expect(results.textContent).toContain('today, 07:15')
    expect(screen.getByRole('button', { name: 'save Tide chronology' }).textContent).toBe('saved')
    expect(screen.queryByRole('heading', { name: 'today · 1 post' })).toBeNull()

    await user.clear(field)
    expect(await screen.findByRole('heading', { name: 'today · 1 post' })).toBeDefined()
    expect(screen.queryByRole('region', { name: 'search results' })).toBeNull()
    expect(window.location.pathname).toBe('/digest')
  })

  it('says while it is searching, and that nothing matched when nothing did', async () => {
    const answer = Promise.withResolvers<void>()
    stubApi()
      .on('GET /api/digest', { body: DIGEST })
      .on('GET /api/search?q=driftwood', async () => {
        await answer.promise
        return { body: { scope: 'everywhere', subscriptions: [], results: [] } }
      })
    window.history.replaceState(null, '', '/')
    render(<App />)
    const user = userEvent.setup()

    await user.type(await screen.findByRole('searchbox', { name: 'search your reading' }), 'driftwood')

    expect((await screen.findByRole('status')).textContent).toBe('searching…')
    answer.resolve()
    expect((await screen.findByText('nothing in your reading matches “driftwood”')).getAttribute('role')).toBe('status')
  })

  it('keeps the last results in view while the next search is answered', async () => {
    const answer = Promise.withResolvers<void>()
    const api = stubApi()
      .on('GET /api/digest', { body: DIGEST })
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

    const field = await screen.findByRole('searchbox', { name: 'search your reading' })
    await user.type(field, 'drift')
    const results = await screen.findByRole('region', { name: 'search results' })

    await user.type(field, 'wood')
    await waitFor(() => expect(api.requestsTo('GET /api/search?q=driftwood')).toHaveLength(1))
    expect(results.getAttribute('aria-busy')).toBe('true')
    expect(within(results).getByRole('link', { name: 'Driftwood morning' })).toBeDefined()
    expect(screen.queryByText('searching…')).toBeNull()

    answer.resolve()
    expect(await screen.findByText('nothing in your reading matches “driftwood”')).toBeDefined()
  })

  it('tells a silent network apart from a refusing server for a search too', async () => {
    const api = stubApi()
      .on('GET /api/digest', { body: DIGEST })
      .on('GET /api/search?q=drift', () => {
        throw new TypeError('fetch failed')
      })
    window.history.replaceState(null, '', '/')
    render(<App />)
    const user = userEvent.setup()

    const field = await screen.findByRole('searchbox', { name: 'search your reading' })
    await user.type(field, 'drift')
    expect(await screen.findByText('search is out of reach — check the connection, then try again')).toBeDefined()

    api.on('GET /api/search?q=driftless', {
      status: 503,
      body: { error: { code: 'unavailable', message: 'Unavailable' } },
    })
    await user.type(field, 'less')
    expect(await screen.findByText('search is unavailable — try again in a moment')).toBeDefined()
  })

  it('answers a shared search address with the results it names', async () => {
    stubApi()
      .on('GET /api/digest', { body: DIGEST })
      .on('GET /api/search?q=chronology', {
        body: { scope: 'everywhere', subscriptions: [], results: [result(9, 'Morning chronology', 'today, 07:15')] },
      })
    window.history.replaceState(null, '', '/search?q=chronology')
    render(<App />)

    const results = await screen.findByRole('region', { name: 'search results' })
    expect(results.textContent).toContain('Morning chronology')
    const field = await screen.findByRole<HTMLInputElement>('searchbox', { name: 'search your reading' })
    expect(field.value).toBe('chronology')
  })
})
