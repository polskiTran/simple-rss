import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { App } from '../../src/client/app.js'
import type { ReaderArticle } from '../../src/shared/api.js'
import { digest, digestGroup, digestItem, readerArticle, readerItem } from './fixtures.js'
import { stubApi, type StubbedApi } from './stub-api.js'

const ITEM = readerItem({
  nextInDigest: { feedItemId: 4, title: 'Evening notes', feedTitle: 'Field Notes', displayTime: '09:31' },
})

const ARTICLE = readerArticle({
  markdown: '## Dawn\n\nThe valley turns from grey to *gold* in about twenty minutes.',
  readingTimeMinutes: 4,
})

function reading(): StubbedApi {
  const api = stubApi().on('GET /api/items/3', { body: ITEM }).on('GET /api/items/3/reader', { body: ARTICLE })
  window.history.replaceState(null, '', '/reader/3')
  return api
}

beforeAll(async () => {
  await import('../../src/client/components/article-markdown.js')
})

afterEach(() => {
  vi.unstubAllGlobals()
})

const FEED_METHODS = {
  markdown: '## Feed methods\n\nRead [the notes](https://journal.example/notes).',
  truncated: true,
  readingTimeMinutes: 2,
}

describe('Reader View', () => {
  it('falls back to Feed Content when the original fails, then replaces it with the original on retry', async () => {
    const pending = Promise.withResolvers<void>()
    let healed = false
    const api = reading()
      .on('GET /api/items/3', { body: { ...ITEM, feedContent: FEED_METHODS } })
      .on('GET /api/items/3/reader', async () => {
        await pending.promise
        return healed
          ? { body: ARTICLE }
          : { status: 502, body: { error: { code: 'article_unreachable', message: 'not today' } } }
      })
    render(<App />)
    const user = userEvent.setup()
    expect(await screen.findByText('Reading the Original webpage')).toBeDefined()
    expect(screen.queryByRole('heading', { name: 'Feed methods' })).toBeNull()
    pending.resolve()
    await screen.findByRole('button', { name: 'Retry' })
    expect(await screen.findByRole('heading', { name: 'Feed methods' })).toBeDefined()
    expect(screen.getByText('Feed content for now')).toBeDefined()
    expect(screen.getByText('2 min read, shortened')).toBeDefined()
    expect(api.requestsTo('GET /api/items/3/reader')).toHaveLength(1)

    healed = true
    await user.click(screen.getByRole('button', { name: 'Retry' }))
    await screen.findByRole('heading', { name: 'Dawn' })
    expect(screen.getByText('4 min read')).toBeDefined()
    expect(screen.queryByText(/for now/)).toBeNull()
    expect(screen.queryByRole('heading', { name: 'Feed methods' })).toBeNull()

    await user.click(screen.getByRole('button', { name: 'Feed content' }))
    expect(screen.getByRole('heading', { name: 'Feed methods' })).toBeDefined()
    expect(screen.queryByRole('heading', { name: 'Dawn' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Feed content' }).getAttribute('aria-pressed')).toBe('true')
  })

  it('uses the Subscription preference without requesting the original and ignores a held old source', async () => {
    const original = Promise.withResolvers<{ body: ReaderArticle }>()
    const feedContent = {
      markdown: '## Feed methods\n\nA short body from the Feed.',
      truncated: true,
      readingTimeMinutes: 1,
    }
    const api = reading()
      .on('GET /api/items/3', { body: { ...ITEM, readingSource: 'feed-content', feedContent } })
      .on('GET /api/items/3/reader', async () => original.promise)
    render(<App />)
    const user = userEvent.setup()

    expect(await screen.findByRole('heading', { name: 'Feed methods' })).toBeDefined()
    expect(screen.getByRole('button', { name: 'Feed content' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByText('1 min read, shortened')).toBeDefined()
    expect(api.requestsTo('GET /api/items/3/reader')).toHaveLength(0)

    await user.click(screen.getByRole('button', { name: 'Original webpage' }))
    expect(api.requestsTo('GET /api/items/3/reader')).toHaveLength(1)
    expect(screen.getByText('Reading the Original webpage')).toBeDefined()
    await user.click(screen.getByRole('button', { name: 'Feed content' }))
    original.resolve({ body: ARTICLE })

    await waitFor(() => expect(screen.getByRole('heading', { name: 'Feed methods' })).toBeDefined())
    expect(screen.queryByRole('heading', { name: 'Dawn' })).toBeNull()
    expect(screen.queryByText(/for now/)).toBeNull()
  })

  it('uses the Original webpage when Feed Content is preferred but unavailable', async () => {
    const api = reading().on('GET /api/items/3', { body: { ...ITEM, readingSource: 'feed-content' } })
    render(<App />)

    expect(await screen.findByRole('heading', { name: 'Dawn' })).toBeDefined()
    expect(screen.getByRole('button', { name: 'Original webpage' }).getAttribute('aria-pressed')).toBe('true')
    expect(api.requestsTo('GET /api/items/3/reader')).toHaveLength(1)
  })

  it('links the Discussion in a new tab when the Feed declares one, and leaves it out when not', async () => {
    reading().on('GET /api/items/3', { body: { ...ITEM, discussionUrl: 'https://news.ycombinator.com/item?id=1' } })
    const { unmount } = render(<App />)

    const discussion = await screen.findByRole('link', { name: 'Discussion' })
    expect(discussion.getAttribute('href')).toBe('https://news.ycombinator.com/item?id=1')
    expect(discussion.getAttribute('target')).toBe('_blank')
    expect(discussion.getAttribute('rel')).toBe('noopener noreferrer')
    unmount()

    reading()
    render(<App />)
    expect(await screen.findByRole('heading', { level: 1, name: 'First light' })).toBeDefined()
    expect(screen.queryByRole('link', { name: 'Discussion' })).toBeNull()
  })

  it('reads Feed Content without claiming a failure when the Original webpage has no link', async () => {
    const feedContent = {
      markdown: '## Feed methods\n\nA body from the Feed.',
      truncated: false,
      readingTimeMinutes: 1,
    }
    const api = reading().on('GET /api/items/3', { body: { ...ITEM, link: null, feedContent } })
    render(<App />)

    expect(await screen.findByRole('heading', { name: 'Feed methods' })).toBeDefined()
    expect(screen.getByRole('button', { name: 'Feed content' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.queryByText(/couldn’t be read/)).toBeNull()
    expect(api.requestsTo('GET /api/items/3/reader')).toHaveLength(0)
  })

  it('presents title, Feed, day, reading time, Save, the Original webpage and the article, then Next', async () => {
    reading()
    render(<App />)

    expect(await screen.findByRole('heading', { level: 1, name: 'First light' })).toBeDefined()
    expect(screen.getByRole('link', { name: 'Field Notes' }).getAttribute('href')).toBe('/feeds/1')
    expect(screen.getByText('Today')).toBeDefined()
    await screen.findByText('4 min read')

    const original = screen.getByRole('link', { name: 'Open the Original webpage' })
    expect(original.getAttribute('href')).toBe('https://journal.example/first-light')
    expect(original.getAttribute('target')).toBe('_blank')
    expect(original.getAttribute('rel')).toBe('noopener noreferrer')

    expect(await screen.findByRole('heading', { name: 'Dawn' })).toBeDefined()
    expect(screen.getByText(/turns from grey to/)).toBeDefined()
    expect(screen.getByRole('button', { name: 'Save First light' }).getAttribute('aria-pressed')).toBe('false')
    expect(screen.getByRole('link', { name: /Evening notes/ }).getAttribute('href')).toBe('/reader/4')
  })

  it('saves and unsaves from the Reader through the Library contract', async () => {
    const api = reading().on('PUT /api/library/3', {
      body: { feedItemId: 3, saved: true, savedAt: '2026-08-08T09:05:00.000Z' },
    })
    render(<App />)
    const user = userEvent.setup()

    const toggle = await screen.findByRole('button', { name: 'Save First light' })
    await user.click(toggle)

    await waitFor(() => expect(toggle.getAttribute('aria-pressed')).toBe('true'))
    expect(toggle.getAttribute('aria-label')).toBe('Saved First light')
    expect(api.requestsTo('PUT /api/library/3')).toHaveLength(1)
  })

  it('says so when saving fails, leaving the Feed Item unsaved', async () => {
    reading().on('PUT /api/library/3', {
      status: 503,
      body: { error: { code: 'unavailable', message: 'Unavailable' } },
    })
    render(<App />)
    const user = userEvent.setup()

    const toggle = await screen.findByRole('button', { name: 'Save First light' })
    await user.click(toggle)

    expect(await screen.findByText('“First light” couldn’t be saved. Try once more.')).toBeDefined()
    expect(toggle.getAttribute('aria-pressed')).toBe('false')
  })

  it('falls back to the stored summary with the Original webpage, and a retry opens the article', async () => {
    let healed = false
    reading().on('GET /api/items/3/reader', () =>
      healed
        ? { body: ARTICLE }
        : { status: 502, body: { error: { code: 'article_unreachable', message: 'not today' } } },
    )
    render(<App />)
    const user = userEvent.setup()

    expect(await screen.findByText('A clear morning over the valley.')).toBeDefined()
    const retry = await screen.findByRole('button', { name: 'Retry' })
    expect(screen.getAllByRole('link', { name: 'Open the Original webpage' }).length).toBeGreaterThan(0)

    healed = true
    await user.click(retry)
    expect(await screen.findByRole('heading', { name: 'Dawn' }, { timeout: 5_000 })).toBeDefined()
  })

  it('holds the summary through a deadline and refetches into the article by itself', async () => {
    vi.useFakeTimers()
    try {
      let calls = 0
      const api = reading().on('GET /api/items/3/reader', () => {
        calls += 1
        return calls === 1
          ? {
              status: 504,
              body: { error: { code: 'article_deadline_exceeded', message: 'preparing', stage: 'publisher' } },
            }
          : { body: ARTICLE }
      })
      render(<App />)

      await act(() => vi.advanceTimersByTimeAsync(0))
      expect(screen.getByText('A clear morning over the valley.')).toBeDefined()
      expect(screen.getByText('Waiting on the publisher')).toBeDefined()
      expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull()

      await act(() => vi.advanceTimersByTimeAsync(2_000))
      expect(screen.getByRole('heading', { name: 'Dawn' })).toBeDefined()
      expect(api.requestsTo('GET /api/items/3/reader')).toHaveLength(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it.each([
    ['publisher', 'Waiting on the publisher', 'The publisher didn’t answer in time.'],
    ['parsing', 'Still reading the original webpage', 'Reading the original webpage took too long.'],
  ] as const)(
    'names the %s stage while waiting and once the quiet refetches are spent',
    async (stage, waiting, spent) => {
      vi.useFakeTimers()
      try {
        const api = stubApi()
          .on('GET /api/items/3', { body: { ...ITEM, summary: null } })
          .on('GET /api/items/3/reader', {
            status: 504,
            body: { error: { code: 'article_deadline_exceeded', message: 'preparing', stage } },
          })
        window.history.replaceState(null, '', '/reader/3')
        render(<App />)

        await act(() => vi.advanceTimersByTimeAsync(0))
        expect(screen.getByText(waiting)).toBeDefined()

        await act(() => vi.advanceTimersByTimeAsync(2_000))
        await act(() => vi.advanceTimersByTimeAsync(2_000))
        expect(screen.getByText(new RegExp(spent))).toBeDefined()
        expect(screen.getByRole('button', { name: 'Retry' })).toBeDefined()
        expect(api.requestsTo('GET /api/items/3/reader')).toHaveLength(3)
      } finally {
        vi.useRealTimers()
      }
    },
  )

  it('drops a deadline stage with its load, so a retry starts from plain reading', async () => {
    vi.useFakeTimers()
    try {
      let calls = 0
      stubApi()
        .on('GET /api/items/3', { body: { ...ITEM, summary: null } })
        .on('GET /api/items/3/reader', () => {
          calls += 1
          return calls <= 3
            ? {
                status: 504,
                body: { error: { code: 'article_deadline_exceeded', message: 'preparing', stage: 'parsing' } },
              }
            : new Promise<never>(() => {})
        })
      window.history.replaceState(null, '', '/reader/3')
      render(<App />)

      await act(() => vi.advanceTimersByTimeAsync(0))
      await act(() => vi.advanceTimersByTimeAsync(2_000))
      await act(() => vi.advanceTimersByTimeAsync(2_000))
      expect(screen.getByText(/Reading the original webpage took too long\./)).toBeDefined()

      fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
      await act(() => vi.advanceTimersByTimeAsync(0))
      expect(screen.getByText('Reading the Original webpage')).toBeDefined()
      expect(screen.queryByText('Still reading the original webpage')).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps the Feed Item usable without either Reading Source and does not loop', async () => {
    const api = reading().on('GET /api/items/3', { body: { ...ITEM, link: null, feedContent: null } })
    render(<App />)

    expect(await screen.findByText('A clear morning over the valley.')).toBeDefined()
    expect(screen.getByRole('heading', { level: 1, name: 'First light' })).toBeDefined()
    expect(screen.getByRole('button', { name: 'Save First light' })).toBeDefined()
    expect(screen.queryByRole('link', { name: 'Open the Original webpage' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull()
    expect(api.requestsTo('GET /api/items/3/reader')).toHaveLength(0)
  })

  it('says how long to wait when retrying is rate-limited', async () => {
    reading().on('GET /api/items/3/reader', {
      status: 429,
      headers: { 'retry-after': '21' },
      body: { error: { code: 'reader_retry_rate_limited', message: 'wait' } },
    })
    render(<App />)

    expect(await screen.findByText(/Wait 21 seconds, then retry\./)).toBeDefined()
  })

  it('goes back to where it was opened from', async () => {
    reading()
    render(<App />)
    const user = userEvent.setup()
    await screen.findByRole('heading', { level: 1, name: 'First light' })

    await user.click(screen.getByRole('link', { name: 'Digest', current: false }))

    expect(window.location.pathname).toBe('/digest')
    expect(screen.queryByRole('heading', { level: 1, name: 'First light' })).toBeNull()
  })

  it('opens from a Digest title and walks on via Next', async () => {
    reading()
      .on('GET /api/digest', {
        body: digest({ groups: [digestGroup({ items: [digestItem({ summary: ITEM.summary })] })] }),
      })
      .on('GET /api/items/4', { body: { ...ITEM, feedItemId: 4, title: 'Evening notes', nextInDigest: null } })
      .on('GET /api/items/4/reader', { body: { ...ARTICLE, feedItemId: 4 } })
    window.history.replaceState(null, '', '/digest')
    render(<App />)
    const user = userEvent.setup()

    const title = await screen.findByRole('link', { name: 'First light' })
    expect(title.getAttribute('href')).toBe('/reader/3')
    await user.click(title)

    expect(await screen.findByRole('heading', { level: 1, name: 'First light' })).toBeDefined()
    expect(window.location.pathname).toBe('/reader/3')

    await user.click(await screen.findByRole('link', { name: /Evening notes/ }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Evening notes' })).toBeDefined()
    expect(window.location.pathname).toBe('/reader/4')
    expect(screen.queryByText('Next')).toBeNull()
  })
})
