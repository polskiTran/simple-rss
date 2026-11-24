import { render, screen, waitFor, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App } from '../../src/client/app.js'
import type { MatchRange, SearchResults } from '../../src/shared/api.js'
import { day, digest, searchResult } from './fixtures.js'
import { stubApi } from './stub-api.js'

const result = (feedItemId: number, title: string, date: string, saved = false) =>
  searchResult({ feedItemId, title: { text: title, matches: [] }, date: day(date), saved })

const nothing: Extract<SearchResults, { scope: 'everywhere' }> = {
  scope: 'everywhere',
  today: day('2026-08-08'),
  subscriptions: [],
  results: [],
}

afterEach(() => {
  vi.unstubAllGlobals()
})

const marksIn = (container: HTMLElement) =>
  [...container.querySelectorAll('mark.x-match')].map((mark) => mark.textContent)

async function search(words: string) {
  const user = userEvent.setup()
  const field = await screen.findByRole('searchbox', { name: 'Search your reading' })
  await user.clear(field)
  await user.type(field, `${words}{Enter}`)
  return user
}

describe('the search line in the top bar', () => {
  it('opens results that give title, Feed, day and saved state, grouped under their Feed', async () => {
    stubApi()
      .on('GET /api/digest', { body: digest() })
      .on('GET /api/search?q=chronology', {
        body: {
          ...nothing,
          results: [result(9, 'Morning chronology', '2026-08-08'), result(8, 'Tide chronology', '2026-06-03', true)],
        },
      })
    window.history.replaceState(null, '', '/')
    render(<App />)

    await search('chronology')

    const results = await screen.findByRole('region', { name: 'Search results' })
    expect(window.location.pathname + window.location.search).toBe('/search?q=chronology')
    const group = within(results).getByRole('region', { name: 'Field Notes' })
    expect(within(group).getByRole('link', { name: 'Morning chronology' })).toBeDefined()
    expect(group.textContent).toContain('Today, 07:15')
    expect(group.textContent).toContain('3 June')
    expect(screen.getByRole('button', { name: 'Saved Tide chronology' }).getAttribute('aria-pressed')).toBe('true')
  })

  it('says while it is searching, and that nothing matched when nothing did', async () => {
    const answer = Promise.withResolvers<void>()
    stubApi()
      .on('GET /api/digest', { body: digest() })
      .on('GET /api/search?q=driftwood', async () => {
        await answer.promise
        return { body: nothing }
      })
    window.history.replaceState(null, '', '/')
    render(<App />)

    await search('driftwood')

    expect(await screen.findByText('Searching your reading')).toBeDefined()
    answer.resolve()
    expect((await screen.findByText('Nothing in your reading matches.')).getAttribute('role')).toBe('status')
  })

  it('keeps the last results in view while the next search is answered', async () => {
    const answer = Promise.withResolvers<void>()
    const api = stubApi()
      .on('GET /api/digest', { body: digest() })
      .on('GET /api/search?q=drift', { body: { ...nothing, results: [result(9, 'Driftwood morning', '2026-08-08')] } })
      .on('GET /api/search?q=driftwood', async () => {
        await answer.promise
        return { body: nothing }
      })
    window.history.replaceState(null, '', '/search?q=drift')
    render(<App />)
    await screen.findByRole('link', { name: 'Driftwood morning' })

    await search('driftwood')
    await waitFor(() => expect(api.requestsTo('GET /api/search?q=driftwood')).toHaveLength(1))
    expect(screen.getByRole('link', { name: 'Driftwood morning' })).toBeDefined()

    answer.resolve()
    expect(await screen.findByText('Nothing in your reading matches.')).toBeDefined()
  })

  it('tells a silent network apart from a refusing server for a search too', async () => {
    const api = stubApi().on('GET /api/search?q=drift', () => {
      throw new TypeError('fetch failed')
    })
    window.history.replaceState(null, '', '/search?q=drift')
    render(<App />)
    expect(await screen.findByText(/The search can’t be reached\./)).toBeDefined()

    api.on('GET /api/search?q=driftless', {
      status: 503,
      body: { error: { code: 'unavailable', message: 'Unavailable' } },
    })
    await search('driftless')
    expect(await screen.findByText(/The search didn’t load\./)).toBeDefined()
  })

  it('answers a shared search address with the results it names, and holds its words in the line', async () => {
    stubApi().on('GET /api/search?q=chronology', {
      body: { ...nothing, results: [result(9, 'Morning chronology', '2026-08-08')] },
    })
    window.history.replaceState(null, '', '/search?q=chronology')
    render(<App />)

    expect(await screen.findByRole('link', { name: 'Morning chronology' })).toBeDefined()
    const field = screen.getByRole<HTMLInputElement>('searchbox', { name: 'Search your reading' })
    expect(field.value).toBe('chronology')
  })

  it('ranks by newest on request, keeping the order in the address while the words change', async () => {
    const api = stubApi()
      .on('GET /api/search?q=chronology', {
        body: { ...nothing, results: [result(9, 'Morning chronology', '2026-08-08')] },
      })
      .on('GET /api/search?q=chronology&sort=newest', {
        body: { ...nothing, results: [result(8, 'Tide chronology', '2026-06-03')] },
      })
      .on('GET /api/search?q=chronology+notes&sort=newest', { body: nothing })
    window.history.replaceState(null, '', '/search?q=chronology')
    render(<App />)
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'Newest' }))

    expect(await screen.findByRole('link', { name: 'Tide chronology' })).toBeDefined()
    expect(window.location.search).toBe('?q=chronology&sort=newest')

    await search('chronology notes')
    await waitFor(() => expect(api.requestsTo('GET /api/search?q=chronology+notes&sort=newest')).toHaveLength(1))
  })

  it('offers no ranking where the answer is Subscriptions alone', async () => {
    stubApi().on('GET /api/search?q=field&in=subscriptions', {
      body: { scope: 'subscriptions', today: '2026-08-08', subscriptions: [] },
    })
    window.history.replaceState(null, '', '/search?q=field&in=subscriptions')
    render(<App />)

    expect(await screen.findByText('Nothing in your feeds matches.')).toBeDefined()
    expect(screen.queryByRole('button', { name: 'Newest' })).toBeNull()
  })

  it('marks exactly the ranges the server matched, in the title and the snippet alike', async () => {
    stubApi().on('GET /api/search?q=Tide', {
      body: {
        ...nothing,
        results: [
          searchResult({
            feedItemId: 9,
            title: { text: 'Tide chronology', matches: [[0, 4]] },
            snippet: {
              text: 'Low tide came early, then tides turned.',
              matches: [
                [4, 8],
                [26, 31],
              ],
            },
          }),
        ],
      },
    })
    window.history.replaceState(null, '', '/search?q=Tide')
    const { container } = render(<App />)

    await screen.findByRole('link', { name: 'Tide chronology' })
    expect(marksIn(container)).toEqual(['Tide', 'tide', 'tides'])
    expect(container.querySelector('.x-search-snippet')?.textContent).toBe('Low tide came early, then tides turned.')
  })

  it.each([
    { query: 'c%2B%2B+--', matches: [[9, 10]], marks: ['C'] },
    {
      query: 'c',
      matches: [
        [9, 10],
        [20, 29],
      ],
      marks: ['C', 'compilers'],
    },
  ] satisfies { query: string; matches: MatchRange[]; marks: string[] }[])(
    'marks what the server matched for $query, not the words as typed',
    async ({ query, matches, marks }) => {
      stubApi().on(`GET /api/search?q=${query}`, {
        body: { ...nothing, results: [searchResult({ title: { text: 'Notes on C++ -- and compilers', matches } })] },
      })
      window.history.replaceState(null, '', `/search?q=${query}`)
      const { container } = render(<App />)

      await screen.findByRole('region', { name: 'Search results' })
      expect(marksIn(container)).toEqual(marks)
    },
  )

  it('narrows a search of everything to one Feed from its group', async () => {
    const api = stubApi()
      .on('GET /api/search?q=light', {
        body: {
          ...nothing,
          results: [
            result(9, 'Morning light', '2026-08-08'),
            { ...result(7, 'Coast light', '2026-06-03'), feedId: 2, feedTitle: 'The Slow Press' },
          ],
        },
      })
      .on('GET /api/search?q=light&feed=2', {
        body: {
          scope: 'feed',
          today: '2026-08-08',
          feed: { title: 'The Slow Press' },
          results: [{ ...result(7, 'Coast light', '2026-06-03'), feedId: 2, feedTitle: 'The Slow Press' }],
        },
      })
    window.history.replaceState(null, '', '/search?q=light')
    render(<App />)
    const user = userEvent.setup()

    const group = await screen.findByRole('region', { name: 'The Slow Press' })
    await user.click(within(group).getByRole('button', { name: 'Search only here' }))

    await waitFor(() => expect(api.requestsTo('GET /api/search?q=light&feed=2')).toHaveLength(1))
    expect(await screen.findByRole('button', { name: 'The Slow Press', pressed: true })).toBeDefined()
    expect(screen.queryByRole('link', { name: 'Morning light' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Search only here' })).toBeNull()
  })
})
