import { render, screen, waitFor } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App } from '../../src/client/app.js'
import { stubApi, type StubbedApi } from './stub-api.js'

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
  nextInDigest: {
    feedItemId: 4,
    title: 'Evening notes',
    feedTitle: 'Field Notes',
    displayTime: '09:31',
  },
}

const ARTICLE = {
  feedItemId: 3,
  markdown: '## Dawn\n\nThe valley turns from grey to *gold* in about twenty minutes.',
  wordCount: 900,
  readingTimeMinutes: 4,
}

function reading(): StubbedApi {
  const api = stubApi()
    .on('GET /api/items/3', { body: ITEM })
    .on('GET /api/items/3/reader', { body: ARTICLE })
  window.history.replaceState(null, '', '/reader/3')
  return api
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('Reader View', () => {
  it('presents title, Feed, date, reading time, save, open original, and the article', async () => {
    reading()
    render(<App />)

    expect(await screen.findByRole('heading', { level: 1, name: 'First light' })).toBeDefined()
    // Twice: the meta row and the next-in-digest attribution.
    expect(screen.getAllByText('Field Notes').length).toBeGreaterThan(0)
    expect(screen.getByText('saturday, 8 august')).toBeDefined()
    await screen.findByText('4 min')

    const original = screen.getByRole('link', { name: 'open original' })
    expect(original.getAttribute('href')).toBe('https://journal.example/first-light')
    expect(original.getAttribute('target')).toBe('_blank')
    expect(original.getAttribute('rel')).toBe('noopener noreferrer')

    // `##` renders one level under the item title, which is the page's h1.
    expect(screen.getByRole('heading', { level: 3, name: 'Dawn' })).toBeDefined()
    expect(screen.getByText(/turns from grey to/)).toBeDefined()

    const toggle = screen.getByRole('button', { name: 'save First light' })
    expect(toggle.textContent).toBe('save')

    // It ends in the digest's next item, never a dead stop.
    expect(screen.getByText('next in the digest')).toBeDefined()
    expect(screen.getByRole('link', { name: 'Evening notes' }).getAttribute('href')).toBe('/reader/4')
  })

  it('saves and unsaves from the Reader through the Library contract', async () => {
    const api = reading()
      .on('PUT /api/library/3', { body: { feedItemId: 3, saved: true, savedAt: '2026-08-08T09:05:00.000Z' } })
    render(<App />)
    const user = userEvent.setup()

    const toggle = await screen.findByRole('button', { name: 'save First light' })
    await user.click(toggle)

    await waitFor(() => expect(toggle.textContent).toBe('saved'))
    expect(api.requestsTo('PUT /api/library/3')).toHaveLength(1)
  })

  it('falls back to the stored summary with open original and retry parsing', async () => {
    let healed = false
    reading().on('GET /api/items/3/reader', () =>
      healed
        ? { body: ARTICLE }
        : { status: 502, body: { error: { code: 'article_unreachable', message: 'not today' } } },
    )
    render(<App />)
    const user = userEvent.setup()

    // The item is untouched: title, summary, and the way to the original.
    expect(await screen.findByText('A clear morning over the valley.')).toBeDefined()
    expect(screen.getAllByRole('link', { name: 'open original' }).length).toBeGreaterThan(0)

    healed = true
    await user.click(screen.getByRole('button', { name: 'retry parsing' }))
    expect(await screen.findByRole('heading', { level: 3, name: 'Dawn' })).toBeDefined()
  })

  it('says how long to wait when retrying is rate-limited', async () => {
    reading().on('GET /api/items/3/reader', {
      status: 429,
      headers: { 'retry-after': '21' },
      body: { error: { code: 'reader_retry_rate_limited', message: 'wait' } },
    })
    render(<App />)

    expect(await screen.findByText(/wait 21s, then retry/)).toBeDefined()
  })

  it('opens from a Digest title and walks on via next in the digest', async () => {
    const digest = {
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
              link: ITEM.link,
              publishedAt: ITEM.publishedAt,
              displayTime: '07:15',
              imageUrl: null,
              summary: ITEM.summary,
              firstSeenAt: ITEM.firstSeenAt,
              saved: false,
            },
          ],
        },
      ],
    }
    reading()
      .on('GET /api/digest', { body: digest })
      .on('GET /api/items/4', {
        body: { ...ITEM, feedItemId: 4, title: 'Evening notes', nextInDigest: null },
      })
      .on('GET /api/items/4/reader', { body: { ...ARTICLE, feedItemId: 4 } })
    window.history.replaceState(null, '', '/digest')
    render(<App />)
    const user = userEvent.setup()

    const title = await screen.findByRole('link', { name: 'First light' })
    expect(title.getAttribute('href')).toBe('/reader/3')
    await user.click(title)

    expect(await screen.findByRole('heading', { level: 1, name: 'First light' })).toBeDefined()
    expect(window.location.pathname).toBe('/reader/3')

    await user.click(await screen.findByRole('link', { name: 'Evening notes' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Evening notes' })).toBeDefined()
    expect(window.location.pathname).toBe('/reader/4')

    // The last item has nothing after it; the reader simply ends calmly.
    expect(screen.queryByText('next in the digest')).toBeNull()
  })
})
