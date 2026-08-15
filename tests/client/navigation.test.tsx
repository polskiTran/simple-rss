import { render, screen } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App } from '../../src/client/app.js'
import { cadenceWindow } from './cadence-window.js'
import { stubApi, type StubbedApi } from './stub-api.js'

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

const DETAIL = {
  feedId: 1,
  title: 'Field Notes',
  reportedTitle: 'Field Notes',
  customTitle: null,
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
  cadence: cadenceWindow({ '2026-08-08': 1 }),
  items: [
    {
      feedItemId: 3,
      title: 'First light',
      link: 'https://journal.example/first-light',
      publishedAt: '2026-08-08T07:15:00.000Z',
      firstSeenAt: '2026-08-08T09:00:00.000Z',
      date: '2026-08-08',
      displayDate: 'today, 07:15',
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
  nextInDigest: null,
}

const LIBRARY = {
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
      displayDate: 'today, 07:15',
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
      displayDate: '3 june',
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

function wayBack() {
  return screen.getByRole('link', { name: /^← / })
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
    expect(wayBack().textContent).toBe('← digest')

    await user.click(wayBack())
    expect(await screen.findByRole('heading', { name: 'today · 1 post' })).toBeDefined()
    expect(window.location.pathname).toBe('/digest')
  })

  it('opens its Feed from a search result too', async () => {
    reading('/digest').on('GET /api/search?q=light', {
      body: {
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
          },
        ],
      },
    })
    render(<App />)
    const user = userEvent.setup()

    await user.type(await screen.findByRole('searchbox', { name: /search your reading/i }), 'light')
    await user.click(await screen.findByRole('link', { name: 'Field Notes' }))

    await openedFeed()
    expect(wayBack().textContent).toBe('← digest')
  })

  it('opens its Feed from the Library, and that Feed returns to the saves', async () => {
    reading('/saved')
    render(<App />)
    const user = userEvent.setup()

    const attribution = await screen.findByRole('link', { name: 'Field Notes' })
    expect(attribution.getAttribute('href')).toBe('/feeds/1')
    await user.click(attribution)

    await openedFeed()
    expect(wayBack().textContent).toBe('← saved')
  })

  it('leaves a save that outlived its Subscription with nowhere to go', async () => {
    reading('/saved')
    render(<App />)

    expect(await screen.findByText('The Slow Press · no longer subscribed')).toBeDefined()
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
    expect(wayBack().textContent).toBe('← article')

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
    expect(wayBack().textContent).toBe('← Field Notes')

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
    expect(wayBack().textContent).toBe('← saved')

    await user.click(wayBack())
    expect(window.location.pathname).toBe('/saved')
  })

  it('falls back to the digest for an article opened by address', async () => {
    reading('/reader/3')
    render(<App />)
    await openedArticle()

    expect(wayBack().textContent).toBe('← digest')
    expect(wayBack().getAttribute('href')).toBe('/digest')
  })

  it('falls back to the feeds list for a Feed opened by address', async () => {
    reading('/feeds/1')
    render(<App />)
    await openedFeed()

    expect(wayBack().textContent).toBe('← feeds')
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
    expect(wayBack().textContent).toBe('← digest')

    await user.click(wayBack())
    expect(window.location.pathname).toBe('/digest')
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
    expect(wayBack().textContent).toBe('← saved')
    expect(activeTab()).toBe('saved')
  })

  it('ignores a way back a history entry has no business holding', async () => {
    reading('/reader/3')
    window.history.replaceState({ origin: { path: 'https://elsewhere.example', label: 'elsewhere' } }, '', '/reader/3')
    render(<App />)
    await openedArticle()

    expect(wayBack().textContent).toBe('← digest')
  })

  it('leaves for the feeds list once the Feed is unsubscribed, whatever led here', async () => {
    reading('/digest').on('DELETE /api/feeds/1', { body: { feedId: 1, unsubscribed: true } })
    render(<App />)
    const user = userEvent.setup()
    await user.click(await screen.findByRole('link', { name: 'Field Notes' }))
    await openedFeed()

    await user.click(screen.getByRole('button', { name: 'unsubscribe' }))
    await user.click(screen.getByRole('button', { name: 'confirm' }))

    expect(await screen.findByRole('textbox', { name: /search or add feeds/i })).toBeDefined()
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
    expect(activeTab()).toBe('saved')
  })

  it('is feeds, for an item opened from one Feed', async () => {
    reading('/feeds/1')
    render(<App />)
    const user = userEvent.setup()

    await user.click(await screen.findByRole('link', { name: 'First light' }))

    await openedArticle()
    expect(activeTab()).toBe('feeds')
  })

  it('is the digest, for an article opened by address', async () => {
    reading('/reader/3')
    render(<App />)

    await openedArticle()
    expect(activeTab()).toBe('digest')
  })

  it('is the digest again once the article is left', async () => {
    reading('/saved')
    render(<App />)
    const user = userEvent.setup()
    await user.click(await screen.findByRole('link', { name: 'First light' }))
    await openedArticle()

    await user.click(screen.getByRole('link', { name: 'digest' }))

    expect(await screen.findByRole('heading', { name: 'today · 1 post' })).toBeDefined()
    expect(activeTab()).toBe('digest')
  })
})
