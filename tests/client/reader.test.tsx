import { act, render, screen, waitFor, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
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
  readingSource: 'original-webpage',
  feedContent: null,
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

describe('Reader View', () => {
  it('shows Feed Content through loading and failure, then replaces it with the original on retry', async () => {
    const pending = Promise.withResolvers<void>()
    let healed = false
    const api = reading()
      .on('GET /api/items/3', {
        body: {
          ...ITEM,
          feedContent: {
            markdown: '## Feed methods\n\nRead [the notes](https://journal.example/notes).',
            truncated: true,
            readingTimeMinutes: 2,
          },
        },
      })
      .on('GET /api/items/3/reader', async () => {
        await pending.promise
        return healed
          ? { body: ARTICLE }
          : { status: 502, body: { error: { code: 'article_unreachable', message: 'not today' } } }
      })
    render(<App />)
    const user = userEvent.setup()
    expect(await screen.findByRole('heading', { name: 'Feed methods' })).toBeDefined()
    expect(screen.getByText('Feed content for now')).toBeDefined()
    expect(screen.getByText('2 min read')).toBeDefined()
    expect(screen.getByText('Shortened by simple. Open the original for the rest.')).toBeDefined()
    expect(screen.getByText('Reading the original webpage')).toBeDefined()
    pending.resolve()
    await screen.findByRole('button', { name: 'Retry' })
    expect(screen.getByRole('heading', { name: 'Feed methods' })).toBeDefined()
    expect(api.requestsTo('GET /api/items/3/reader')).toHaveLength(1)
    healed = true
    await user.click(screen.getByRole('button', { name: 'Retry' }))
    await screen.findByRole('heading', { name: 'Dawn' })
    expect(screen.getByText('4 min read')).toBeDefined()
    expect(screen.queryByText(/for now/)).toBeNull()
    expect(screen.queryByRole('heading', { name: 'Feed methods' })).toBeNull()
    expect(screen.queryByText(/Shortened by simple/)).toBeNull()

    await user.click(screen.getByRole('button', { name: 'Feed content' }))
    expect(screen.getByRole('heading', { name: 'Feed methods' })).toBeDefined()
    expect(screen.queryByRole('heading', { name: 'Dawn' })).toBeNull()
    expect(screen.getByText('2 min read')).toBeDefined()
    expect(screen.getByRole('button', { name: 'Feed content' }).getAttribute('aria-pressed')).toBe('true')
  })

  it('brings the Original webpage in as a new article over Feed Content, never rewriting it in place', async () => {
    const pending = Promise.withResolvers<void>()
    reading()
      .on('GET /api/items/3', {
        body: { ...ITEM, feedContent: { markdown: '## Feed methods', truncated: true, readingTimeMinutes: 2 } },
      })
      .on('GET /api/items/3/reader', async () => {
        await pending.promise
        return { body: ARTICLE }
      })
    render(<App />)

    const standIn = (await screen.findByRole('heading', { name: 'Feed methods' })).closest('.article-body')
    pending.resolve()
    const arrived = (await screen.findByRole('heading', { name: 'Dawn' })).closest('.article-body')

    expect(arrived).not.toBeNull()
    expect(arrived).not.toBe(standIn)
    expect(standIn?.isConnected).toBe(false)
  })

  it('uses the Subscription preference without requesting the original and ignores a held old source', async () => {
    const original = Promise.withResolvers<{ body: typeof ARTICLE }>()
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
    expect(screen.getByText('1 min read')).toBeDefined()
    expect(screen.getByText('Shortened by simple. Open the original for the rest.')).toBeDefined()
    expect(api.requestsTo('GET /api/items/3/reader')).toHaveLength(0)

    await user.click(screen.getByRole('button', { name: 'Original webpage' }))
    expect(api.requestsTo('GET /api/items/3/reader')).toHaveLength(1)
    expect(screen.getByText('Reading the original webpage')).toBeDefined()
    await user.click(screen.getByRole('button', { name: 'Feed content' }))
    original.resolve({ body: ARTICLE })

    await waitFor(() => expect(screen.getByRole('heading', { name: 'Feed methods' })).toBeDefined())
    expect(screen.queryByRole('heading', { name: 'Dawn' })).toBeNull()
    expect(screen.queryByText(/for now/)).toBeNull()
  })

  it('uses the Original webpage when Feed Content is preferred but unavailable', async () => {
    const api = reading().on('GET /api/items/3', { body: { ...ITEM, readingSource: 'feed-content' } })
    render(<App />)

    expect(await screen.findByRole('heading', { level: 3, name: 'Dawn' })).toBeDefined()
    expect(screen.getByText('Original webpage', { selector: 'span' })).toBeDefined()
    expect(api.requestsTo('GET /api/items/3/reader')).toHaveLength(1)
  })

  it('reads Feed Content without claiming a parse failure when the Original webpage has no link', async () => {
    const feedContent = {
      markdown: '## Feed methods\n\nA body from the Feed.',
      truncated: false,
      readingTimeMinutes: 1,
    }
    const api = reading().on('GET /api/items/3', { body: { ...ITEM, link: null, feedContent } })
    render(<App />)

    expect(await screen.findByRole('heading', { name: 'Feed methods' })).toBeDefined()
    expect(screen.getByText('Feed content', { selector: 'span' })).toBeDefined()
    expect(screen.queryByText('the original page could not be parsed into an article')).toBeNull()
    expect(api.requestsTo('GET /api/items/3/reader')).toHaveLength(0)
  })

  it('presents title, Feed, date, reading time, save, open original, and the article', async () => {
    reading()
    render(<App />)

    expect(await screen.findByRole('heading', { level: 1, name: 'First light' })).toBeDefined()
    expect(screen.getAllByText('Field Notes').length).toBeGreaterThan(0)
    expect(screen.getByText('saturday, 8 august')).toBeDefined()
    await screen.findByText('4 min read')

    const original = screen.getByRole('link', { name: 'Open original' })
    expect(original.getAttribute('href')).toBe('https://journal.example/first-light')
    expect(original.getAttribute('target')).toBe('_blank')
    expect(original.getAttribute('rel')).toBe('noopener noreferrer')

    expect(await screen.findByRole('heading', { level: 3, name: 'Dawn' })).toBeDefined()
    expect(screen.getByText(/turns from grey to/)).toBeDefined()

    const toggle = screen.getByRole('button', { name: 'Save First light' })
    expect(toggle.getAttribute('aria-pressed')).toBe('false')

    expect(screen.getByText('Next in the digest')).toBeDefined()
    expect(screen.getByRole('link', { name: 'Evening notes' }).getAttribute('href')).toBe('/reader/4')
  })

  it('keeps its actions in the chrome and the Reading Source switch under the meta line', async () => {
    const feedContent = { markdown: 'A short body from the Feed.', truncated: false, readingTimeMinutes: 1 }
    reading().on('GET /api/items/3', { body: { ...ITEM, feedContent } })
    render(<App />)

    const meta = (await screen.findByText('saturday, 8 august')).closest('p')
    const [header] = screen.getAllByRole('banner')
    if (!header) throw new Error('the chrome did not render')
    const chrome = within(header)
    expect(chrome.getByRole('link', { name: 'Open original' })).toBeDefined()
    expect(chrome.getByRole('button', { name: 'Save First light' })).toBeDefined()
    expect(meta?.nextElementSibling).toBe(screen.getByRole('group', { name: 'Reading source' }))
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
    // The name carries the word on screen, as it changes.
    expect(toggle.getAttribute('aria-label')).toBe('Saved First light')
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

    expect(await screen.findByText('A clear morning over the valley.')).toBeDefined()
    expect(screen.getAllByRole('link', { name: 'Open original' }).length).toBeGreaterThan(0)

    healed = true
    await user.click(await screen.findByRole('button', { name: 'Retry' }))
    // The first article loads the Markdown renderer lazily; a loaded suite can take over a second.
    expect(await screen.findByRole('heading', { level: 3, name: 'Dawn' }, { timeout: 5_000 })).toBeDefined()
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
      expect(screen.queryByText(/could not be parsed/)).toBeNull()

      await act(() => vi.advanceTimersByTimeAsync(2_000))
      expect(screen.getByRole('heading', { level: 3, name: 'Dawn' })).toBeDefined()
      expect(api.requestsTo('GET /api/items/3/reader')).toHaveLength(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('names the publisher plainly once the quiet refetches are spent', async () => {
    vi.useFakeTimers()
    try {
      const api = stubApi()
        .on('GET /api/items/3', { body: { ...ITEM, summary: null } })
        .on('GET /api/items/3/reader', {
          status: 504,
          body: { error: { code: 'article_deadline_exceeded', message: 'preparing', stage: 'publisher' } },
        })
      window.history.replaceState(null, '', '/reader/3')
      render(<App />)

      await act(() => vi.advanceTimersByTimeAsync(0))
      expect(screen.getByText('Waiting on the publisher')).toBeDefined()

      await act(() => vi.advanceTimersByTimeAsync(2_000))
      await act(() => vi.advanceTimersByTimeAsync(2_000))
      expect(screen.getByText('The publisher didn’t answer in time.')).toBeDefined()
      expect(screen.getAllByRole('link', { name: 'Open original' }).length).toBeGreaterThan(0)
      expect(screen.getByRole('button', { name: 'Retry' })).toBeDefined()
      expect(screen.queryByText(/could not be parsed/)).toBeNull()
      expect(api.requestsTo('GET /api/items/3/reader')).toHaveLength(3)
    } finally {
      vi.useRealTimers()
    }
  })

  it('says it is still reading when the deadline names the parsing stage', async () => {
    vi.useFakeTimers()
    try {
      stubApi()
        .on('GET /api/items/3', { body: { ...ITEM, summary: null } })
        .on('GET /api/items/3/reader', {
          status: 504,
          body: { error: { code: 'article_deadline_exceeded', message: 'preparing', stage: 'parsing' } },
        })
      window.history.replaceState(null, '', '/reader/3')
      render(<App />)

      await act(() => vi.advanceTimersByTimeAsync(0))
      expect(screen.getByText('Still reading the original webpage')).toBeDefined()

      await act(() => vi.advanceTimersByTimeAsync(2_000))
      await act(() => vi.advanceTimersByTimeAsync(2_000))
      expect(screen.getByText('Reading the original webpage took too long.')).toBeDefined()
    } finally {
      vi.useRealTimers()
    }
  })

  it('shows the stored summary while the Reader server remains within its response deadline', async () => {
    vi.useFakeTimers()
    vi.spyOn(AbortSignal, 'timeout').mockImplementation((milliseconds) => {
      const controller = new AbortController()
      setTimeout(() => controller.abort(new DOMException('The operation timed out', 'TimeoutError')), milliseconds)
      return controller.signal
    })

    try {
      const api = reading().on('GET /api/items/3/reader', async () => {
        const { promise, resolve } = Promise.withResolvers<void>()
        setTimeout(resolve, 35_000)
        await promise
        return { body: ARTICLE }
      })
      render(<App />)
      await act(() => vi.advanceTimersByTimeAsync(0))
      expect(api.requestsTo('GET /api/items/3/reader')).toHaveLength(1)
      expect(screen.getByText('A clear morning over the valley.')).toBeDefined()

      await act(() => vi.advanceTimersByTimeAsync(30_001))
      expect(screen.getByText('Reading the original webpage')).toBeDefined()

      await act(() => vi.advanceTimersByTimeAsync(5_000))
      expect(screen.getByRole('heading', { level: 3, name: 'Dawn' })).toBeDefined()
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps metadata usable without either reading source and does not loop', async () => {
    const api = reading()
      .on('GET /api/items/3', { body: { ...ITEM, link: null, feedContent: null } })
      .on('GET /api/items/3/reader', {
        status: 422,
        body: { error: { code: 'no_original_link', message: 'No original link' } },
      })
    render(<App />)
    expect(await screen.findByText('A clear morning over the valley.')).toBeDefined()
    expect(screen.queryByText('the original page could not be parsed into an article')).toBeNull()
    expect(screen.getByRole('heading', { name: 'First light' })).toBeDefined()
    expect(screen.getByRole('button', { name: 'Save First light' })).toBeDefined()
    expect(screen.queryByRole('link', { name: 'Open original' })).toBeNull()
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

    expect(await screen.findByText(/Wait 21 seconds, then retry/)).toBeDefined()
  })

  it('marks the Reader critical path locally without telling any service', async () => {
    performance.clearMarks()
    const api = reading()
    render(<App />)

    await screen.findByRole('heading', { level: 3, name: 'Dawn' })
    await waitFor(() => expect(performance.getEntriesByName('reader:markdown-committed', 'mark')).not.toHaveLength(0))

    const markedAt = (name: string): number => {
      const marks = performance.getEntriesByName(name, 'mark')
      expect(marks.length, name).toBeGreaterThan(0)
      return marks[marks.length - 1]?.startTime ?? Number.NaN
    }
    const entry = markedAt('reader:entry')
    const articleResponse = markedAt('reader:article-response')
    const rendererReady = markedAt('reader:renderer-ready')
    const markdownCommitted = markedAt('reader:markdown-committed')
    expect(entry).toBeLessThanOrEqual(articleResponse)
    expect(entry).toBeLessThanOrEqual(rendererReady)
    expect(articleResponse).toBeLessThanOrEqual(markdownCommitted)
    expect(rendererReady).toBeLessThanOrEqual(markdownCommitted)

    const asked = api.requests.map((request) => `${request.method} ${request.path}`)
    expect(asked).toEqual(expect.arrayContaining(['GET /api/items/3', 'GET /api/items/3/reader']))
    for (const request of asked) expect(request).toMatch(/^GET \/api\//)
  })

  it('closes back to the digest when the mark is pressed', async () => {
    reading()
    render(<App />)
    const user = userEvent.setup()
    await screen.findByRole('heading', { level: 1, name: 'First light' })

    await user.click(screen.getByRole('link', { name: 'simple' }))

    expect(window.location.pathname).toBe('/digest')
    expect(screen.queryByRole('heading', { level: 1, name: 'First light' })).toBeNull()
  })

  it('opens from a Digest title and walks on via next in the digest', async () => {
    const digest = {
      today: '2026-08-08',
      groups: [
        {
          date: '2026-08-08',
          label: 'Today',
          returns: [],
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
      nextFrom: null,
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

    expect(screen.queryByText('Next in the digest')).toBeNull()
  })
})
