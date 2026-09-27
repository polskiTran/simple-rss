import { render, screen, waitFor, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App } from '../../src/client/app.js'
import { cadenceWindow } from './cadence-window.js'
import { stubApi, type StubbedApi } from './stub-api.js'

const DIGEST = {
  today: '2026-08-08',
  groups: [
    {
      date: '2026-08-08',
      label: 'Today',
      count: 1,
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
  availability: {
    state: 'available',
    lastCheckedAt: '2026-08-08T09:00:00.000Z',
    lastSuccessAt: '2026-08-08T09:00:00.000Z',
    consecutiveFailures: 0,
    category: null,
  },
  schedule: { pollingIntervalMinutes: 120, nextPollAt: '2026-08-08T11:00:00.000Z' },
  readingSource: 'original-webpage',
  subscribedDate: '2026-08-08',
  cadence: cadenceWindow({ '2026-08-08': 1 }),
  items: [
    {
      feedItemId: 3,
      title: 'First light',
      link: 'https://journal.example/first-light',
      publishedAt: '2026-08-08T07:15:00.000Z',
      firstSeenAt: '2026-08-08T09:00:00.000Z',
      date: '2026-08-08',
      displayTime: '07:15',
      saved: false,
    },
  ],
}

const ITEM = {
  feedItemId: 3,
  title: 'First light',
  feedId: 1,
  feedTitle: 'Field Notes',
  link: 'https://journal.example/first-light',
  publishedAt: '2026-08-08T07:15:00.000Z',
  firstSeenAt: '2026-08-08T09:00:00.000Z',
  displayDate: 'saturday, 8 august',
  summary: 'A clear morning over the valley.',
  saved: false,
  readingSource: 'original-webpage',
  feedContent: null,
  nextInDigest: null,
}

const LIBRARY = {
  today: '2026-08-08',
  total: 2,
  items: [
    {
      feedItemId: 3,
      title: 'First light',
      feedId: 1,
      feedTitle: 'Field Notes',
      subscribed: true,
      link: 'https://journal.example/first-light',
      publishedAt: '2026-08-08T07:15:00.000Z',
      firstSeenAt: '2026-08-08T09:00:00.000Z',
      savedAt: '2026-08-08T09:05:00.000Z',
      savedDate: '2026-08-08',
    },
    {
      feedItemId: 1,
      title: 'A June letter',
      feedId: 2,
      feedTitle: 'The Slow Press',
      subscribed: false,
      link: null,
      publishedAt: '2026-06-03T12:00:00.000Z',
      firstSeenAt: '2026-06-03T13:00:00.000Z',
      savedAt: '2026-08-01T08:00:00.000Z',
      savedDate: '2026-08-01',
    },
  ],
  nextCursor: null,
}

function reading(path: string): StubbedApi {
  const api = stubApi()
    .on('GET /api/digest', { body: DIGEST })
    .on('GET /api/feeds/1', { body: DETAIL })
    .on('GET /api/items/3', { body: ITEM })
    .on('GET /api/items/3/reader', {
      body: { feedItemId: 3, markdown: 'The valley turns from grey to gold.', wordCount: 8, readingTimeMinutes: 1 },
    })
    .on('GET /api/library', { body: LIBRARY })
  window.history.replaceState(null, '', path)
  return api
}

/** The view's own way back; the phone bar repeats it outside `main`. */
function wayBack() {
  return within(screen.getByRole('main')).getByRole('link', { name: /^Back to / })
}

/** The scope the results' switch holds. */
function pressedScope() {
  const scopes = screen.getByRole('group', { name: 'Search in' })
  return within(scopes)
    .getAllByRole('button')
    .find((scope) => scope.getAttribute('aria-pressed') === 'true')?.textContent
}

function activeTab() {
  return screen.getByRole('link', { current: 'page' }).textContent
}

const openedFeed = () => screen.findByText('journal.example')
const openedArticle = () => screen.findByRole('heading', { level: 1, name: 'First light' })

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('a Feed Item’s attribution', () => {
  it('opens its Feed from the Digest, and that Feed returns to the Digest', async () => {
    reading('/digest')
    render(<App />)
    const user = userEvent.setup()

    const attribution = await screen.findByRole('link', { name: 'Field Notes' })
    expect(attribution.getAttribute('href')).toBe('/feeds/1')
    await user.click(attribution)

    await openedFeed()
    expect(window.location.pathname).toBe('/feeds/1')
    expect(wayBack().textContent).toBe('Digest')

    await user.click(wayBack())
    expect(await screen.findByRole('heading', { name: 'Today 1' })).toBeDefined()
    expect(window.location.pathname).toBe('/digest')
  })

  it('returns an article opened from one day of the Digest to that same day', async () => {
    reading('/digest?by=day&day=2026-08-07')
      .on('GET /api/digest/days', { body: { today: '2026-08-08', days: cadenceWindow(), subscriptions: 1 } })
      .on('GET /api/digest/days/2026-08-07', { body: { date: '2026-08-07', feeds: [] } })
      .on('GET /api/digest?day=2026-08-07', { body: DIGEST })
    render(<App />)
    const user = userEvent.setup()

    await user.click(await screen.findByRole('link', { name: 'First light' }))
    await openedArticle()
    expect(wayBack().textContent).toBe('Digest')

    await user.click(wayBack())
    expect(await screen.findByRole('heading', { name: 'Today 1' })).toBeDefined()
    expect(window.location.pathname + window.location.search).toBe('/digest?by=day&day=2026-08-07')
    expect(screen.getByRole('button', { name: 'By day' }).getAttribute('aria-pressed')).toBe('true')
  })

  it('opens its Feed from a search result, and that Feed returns to the results', async () => {
    reading('/digest').on('GET /api/search?q=light', {
      body: {
        scope: 'everywhere',
        subscriptions: [],
        results: [
          {
            feedItemId: 3,
            title: 'First light',
            feedId: 1,
            feedTitle: 'Field Notes',
            publishedAt: '2026-08-08T07:15:00.000Z',
            firstSeenAt: '2026-08-08T09:00:00.000Z',
            displayDate: 'today, 07:15',
            saved: false,
            snippet: null,
          },
        ],
      },
    })
    render(<App />)
    const user = userEvent.setup()

    await user.type(await screen.findByRole('searchbox', { name: /Search your reading/i }), 'light')
    const results = await screen.findByRole('region', { name: 'search results' })
    await user.click(within(results).getByRole('link', { name: 'Field Notes' }))

    await openedFeed()
    expect(wayBack().textContent).toBe('Search')

    await user.click(wayBack())
    expect(await screen.findByRole('region', { name: 'search results' })).toBeDefined()
    expect(screen.getByRole<HTMLInputElement>('searchbox', { name: /Search your reading/i }).value).toBe('light')
  })

  it('opens its Feed from the Library, and that Feed returns to the saves', async () => {
    reading('/saved')
    render(<App />)
    const user = userEvent.setup()

    const attribution = await screen.findByRole('link', { name: 'Field Notes' })
    expect(attribution.getAttribute('href')).toBe('/feeds/1')
    await user.click(attribution)

    await openedFeed()
    expect(wayBack().textContent).toBe('Saved')
  })

  it('leaves a save that outlived its Subscription with nowhere to go', async () => {
    reading('/saved')
    render(<App />)

    expect(await screen.findByText('Saved 1 August · No longer subscribed')).toBeDefined()
    expect(screen.queryByRole('link', { name: /Slow Press/ })).toBeNull()
  })

  it('opens its Feed from the Reader, and that Feed returns to the article', async () => {
    reading('/reader/3')
    render(<App />)
    const user = userEvent.setup()
    await openedArticle()

    const attribution = screen.getByRole('link', { name: 'Field Notes' })
    expect(attribution.getAttribute('href')).toBe('/feeds/1')
    await user.click(attribution)

    await openedFeed()
    expect(wayBack().textContent).toBe('Article')

    await user.click(wayBack())
    expect(await openedArticle()).toBeDefined()
    expect(window.location.pathname).toBe('/reader/3')
  })
})

describe('the way back out of an opened screen', () => {
  it('names the Feed an article was opened from', async () => {
    reading('/feeds/1')
    render(<App />)
    const user = userEvent.setup()

    await user.click(await screen.findByRole('link', { name: 'First light' }))

    await openedArticle()
    expect(window.location.pathname).toBe('/reader/3')
    expect(wayBack().textContent).toBe('Field Notes')

    await user.click(wayBack())
    expect(await openedFeed()).toBeDefined()
    expect(window.location.pathname).toBe('/feeds/1')
  })

  it('returns a saved article to the library it was opened from', async () => {
    reading('/saved')
    render(<App />)
    const user = userEvent.setup()

    await user.click(await screen.findByRole('link', { name: 'First light' }))

    await openedArticle()
    expect(wayBack().textContent).toBe('Saved')

    await user.click(wayBack())
    expect(window.location.pathname).toBe('/saved')
  })

  it('falls back to the digest for an article opened by address', async () => {
    reading('/reader/3')
    render(<App />)
    await openedArticle()

    expect(wayBack().textContent).toBe('Digest')
    expect(wayBack().getAttribute('href')).toBe('/digest')
  })

  it('falls back to the feeds list for a Feed opened by address', async () => {
    reading('/feeds/1')
    render(<App />)
    await openedFeed()

    expect(wayBack().textContent).toBe('Feeds')
    expect(wayBack().getAttribute('href')).toBe('/feeds')
  })

  it('keeps the trail, so a walked path can be walked back', async () => {
    reading('/digest')
    render(<App />)
    const user = userEvent.setup()

    await user.click(await screen.findByRole('link', { name: 'Field Notes' }))
    await openedFeed()
    await user.click(await screen.findByRole('link', { name: 'First light' }))
    await openedArticle()

    await user.click(wayBack())
    await openedFeed()
    expect(wayBack().textContent).toBe('Digest')

    await user.click(wayBack())
    expect(window.location.pathname).toBe('/digest')
  })

  it('goes back to the entry it was opened from rather than stacking another', async () => {
    reading('/digest')
    render(<App />)
    const user = userEvent.setup()
    await user.click(await screen.findByRole('link', { name: 'First light' }))
    await openedArticle()
    const entries = window.history.length

    await user.click(wayBack())

    expect(await screen.findByRole('heading', { name: 'Today 1' })).toBeDefined()
    expect(window.location.pathname).toBe('/digest')
    expect(window.history.length).toBe(entries)
  })

  it('walks to the origin of an article opened by address, which the browser’s Back then leaves', async () => {
    reading('/reader/3')
    render(<App />)
    const user = userEvent.setup()
    await openedArticle()

    await user.click(wayBack())
    expect(await screen.findByRole('heading', { name: 'Today 1' })).toBeDefined()

    window.history.back()
    expect(await openedArticle()).toBeDefined()
  })

  it('is restored with the entry the browser goes back to', async () => {
    reading('/saved')
    render(<App />)
    const user = userEvent.setup()
    await user.click(await screen.findByRole('link', { name: 'First light' }))
    await openedArticle()
    await user.click(screen.getByRole('link', { name: 'simple' }))
    expect(window.location.pathname).toBe('/digest')

    window.history.back()

    await openedArticle()
    expect(wayBack().textContent).toBe('Saved')
    expect(activeTab()).toBe('Saved')
  })

  it('ignores a way back a history entry has no business holding', async () => {
    reading('/reader/3')
    window.history.replaceState({ origin: { path: 'https://elsewhere.example', label: 'elsewhere' } }, '', '/reader/3')
    render(<App />)
    await openedArticle()

    expect(wayBack().textContent).toBe('Digest')
  })

  it('leaves for the feeds list once the Feed is unsubscribed, whatever led here', async () => {
    reading('/digest').on('DELETE /api/feeds/1', { body: { feedId: 1, unsubscribed: true } })
    render(<App />)
    const user = userEvent.setup()
    await user.click(await screen.findByRole('link', { name: 'Field Notes' }))
    await openedFeed()

    await user.click(screen.getByRole('button', { name: 'Unsubscribe' }))
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Unsubscribe' }))

    expect(await screen.findByRole('heading', { level: 1, name: /^Feeds/ })).toBeDefined()
    expect(window.location.pathname).toBe('/feeds')
  })
})

describe('the section an open article reads under', () => {
  it('is the library, for a save opened from it', async () => {
    reading('/saved')
    render(<App />)
    const user = userEvent.setup()

    await user.click(await screen.findByRole('link', { name: 'First light' }))

    await openedArticle()
    expect(activeTab()).toBe('Saved')
  })

  it('is feeds, for an item opened from one Feed', async () => {
    reading('/feeds/1')
    render(<App />)
    const user = userEvent.setup()

    await user.click(await screen.findByRole('link', { name: 'First light' }))

    await openedArticle()
    expect(activeTab()).toBe('Feeds')
  })

  it('is the digest, for an article opened by address', async () => {
    reading('/reader/3')
    render(<App />)

    await openedArticle()
    expect(activeTab()).toBe('Digest')
  })

  it('is the digest again once the article is left', async () => {
    reading('/saved')
    render(<App />)
    const user = userEvent.setup()
    await user.click(await screen.findByRole('link', { name: 'First light' }))
    await openedArticle()

    await user.click(screen.getByRole('link', { name: 'Digest' }))

    expect(await screen.findByRole('heading', { name: 'Today 1' })).toBeDefined()
    expect(activeTab()).toBe('Digest')
  })
})

describe('the scope a search takes from its screen', () => {
  const found = (...titles: string[]) =>
    titles.map((title, index) => ({
      feedItemId: 3 + index,
      title,
      feedId: 1,
      feedTitle: 'Field Notes',
      publishedAt: '2026-08-08T07:15:00.000Z',
      firstSeenAt: '2026-08-08T09:00:00.000Z',
      displayDate: 'today, 07:15',
      saved: false,
      snippet: null,
    }))
  const withinFeed = { body: { scope: 'feed', feed: { title: 'Field Notes' }, results: found('First light') } }
  const everywhere = { body: { scope: 'everywhere', subscriptions: [], results: found('First light', 'Coast light') } }

  it('from an opened Feed, answers within it and names it; everywhere steps out, and clearing lands back on the Feed', async () => {
    const api = reading('/feeds/1')
      .on('GET /api/search?q=light&feed=1', withinFeed)
      .on('GET /api/search?q=light', everywhere)
    render(<App />)
    const user = userEvent.setup()
    await openedFeed()

    await user.type(screen.getByRole('searchbox', { name: 'Search this feed' }), 'light')
    const results = await screen.findByRole('region', { name: 'search results' })
    expect(window.location.pathname + window.location.search).toBe('/search?q=light&feed=1')
    expect(within(results).getByRole('link', { name: 'First light' })).toBeDefined()
    expect(within(results).queryByRole('link', { name: 'Field Notes' })).toBeNull()
    expect(screen.getByRole('heading', { level: 1, name: '“light” 1 result in Field Notes' })).toBeDefined()
    expect(pressedScope()).toBe('This feed')
    expect(activeTab()).toBe('Feeds')

    await user.click(screen.getByRole('button', { name: 'Everywhere' }))
    expect(await screen.findByRole('link', { name: 'Coast light' })).toBeDefined()
    expect(window.location.pathname + window.location.search).toBe('/search?q=light')
    expect(api.requestsTo('GET /api/search?q=light')).toHaveLength(1)
    expect(pressedScope()).toBe('Everywhere')
    expect(activeTab()).toBe('Digest')
    await user.click(screen.getByRole('button', { name: 'This feed' }))
    expect(window.location.pathname + window.location.search).toBe('/search?q=light&feed=1')
    expect(pressedScope()).toBe('This feed')
    await user.click(screen.getByRole('button', { name: 'Everywhere' }))

    const field = screen.getByRole<HTMLInputElement>('searchbox', { name: 'Search your reading' })
    expect(field.value).toBe('light')

    await user.clear(field)
    await openedFeed()
    expect(window.location.pathname).toBe('/feeds/1')
  })

  it('keeps its scope in the address, so a reloaded or shared search answers the same', async () => {
    reading('/search?q=light&feed=1').on('GET /api/search?q=light&feed=1', withinFeed)
    render(<App />)

    const results = await screen.findByRole('region', { name: 'search results' })
    expect(within(results).getByRole('link', { name: 'First light' })).toBeDefined()
    expect(pressedScope()).toBe('This feed')
    expect(screen.getByRole<HTMLInputElement>('searchbox', { name: 'Search this feed' }).value).toBe('light')
    expect(activeTab()).toBe('Feeds')
  })

  it('from the Library, answers within it and says so when nothing matches', async () => {
    reading('/saved').on('GET /api/search?q=light&in=saved', { body: { scope: 'saved', results: [] } })
    render(<App />)
    const user = userEvent.setup()
    await screen.findByRole('link', { name: 'First light' })

    await user.type(screen.getByRole('searchbox', { name: 'Search your saves' }), 'light')

    expect((await screen.findByText('Nothing in your saves matches “light”.')).getAttribute('role')).toBe('status')
    expect(pressedScope()).toBe('Saved')
  })

  it('from the Feeds screen, answers with Subscriptions alone', async () => {
    reading('/feeds').on('GET /api/search?q=field&in=subscriptions', {
      body: {
        scope: 'subscriptions',
        subscriptions: [
          {
            feedId: 1,
            title: 'Field Notes',
            domain: 'journal.example',
            homePageUrl: 'https://journal.example/',
            cadence: Array.from({ length: 30 }, () => 0),
          },
        ],
      },
    })
    render(<App />)
    const user = userEvent.setup()
    await screen.findByRole('heading', { level: 1, name: /^Feeds/ })

    await user.type(screen.getByRole('searchbox', { name: 'Search your feeds' }), 'field')

    const jumpTo = await screen.findByRole('navigation', { name: 'matching subscriptions' })
    expect(within(jumpTo).getByRole('link', { name: 'Field Notes' })).toBeDefined()
    expect(pressedScope()).toBe('Feeds')
  })

  it('from the Reader, answers everywhere', async () => {
    reading('/reader/3').on('GET /api/search?q=light', everywhere)
    render(<App />)
    const user = userEvent.setup()
    await openedArticle()

    await user.type(screen.getByRole('searchbox', { name: 'Search your reading' }), 'light')

    await screen.findByRole('region', { name: 'search results' })
    expect(screen.queryByRole('group', { name: 'Search in' })).toBeNull()
  })
})

describe('the screen a navigation arrives at', () => {
  it('names itself in the title and takes focus at its heading, but not on first load', async () => {
    reading('/digest')
    render(<App />)
    const user = userEvent.setup()
    const attribution = await screen.findByRole('link', { name: 'Field Notes' })
    expect(document.title).toBe('Digest — simple')
    expect(document.activeElement).toBe(document.body)

    await user.click(attribution)

    const heading = await screen.findByRole('heading', { level: 1, name: 'Field Notes' })
    expect(document.title).toBe('Field Notes — simple')
    await waitFor(() => expect(document.activeElement).toBe(heading))

    await user.click(wayBack())

    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('heading', { level: 1 })))
    expect(document.title).toBe('Digest — simple')
  })
})
