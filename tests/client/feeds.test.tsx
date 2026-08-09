import { render, screen, waitFor } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App } from '../../src/client/app.js'
import { dailyShadows } from '../../src/client/components/daily-band.js'
import { stubApi, type Reply } from './stub-api.js'

const AVAILABLE = {
  state: 'available',
  lastCheckedAt: '2026-08-08T09:00:00.000Z',
  lastSuccessAt: '2026-08-08T09:00:00.000Z',
  consecutiveFailures: 0,
  category: null,
}

const FEED = {
  feedId: 1,
  title: 'Field Notes',
  domain: 'feeds.example',
  enteredUrl: 'https://journal.example/feed',
  resolvedUrl: 'https://feeds.example/journal.xml',
  cadence: Array.from({ length: 30 }, () => 0),
  availability: AVAILABLE,
}

const UNAVAILABLE_FEED = {
  ...FEED,
  availability: {
    state: 'unavailable',
    lastCheckedAt: '2026-08-08T09:00:00.000Z',
    lastSuccessAt: '2026-08-05T09:00:00.000Z',
    consecutiveFailures: 3,
    category: 'http_error',
  },
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('Feeds', () => {
  it('accepts an exact Feed URL in the search/add control and shows the accepted Feed shape immediately', async () => {
    const api = stubApi()
      .on('GET /api/feeds', { body: { subscriptions: [] } })
      .on('POST /api/subscriptions', {
        status: 201,
        body: { subscription: FEED, importedItems: 1 },
      })
    window.history.replaceState(null, '', '/feeds')
    const { container } = render(<App />)
    const user = userEvent.setup()

    await user.type(await screen.findByRole('textbox', { name: /search or add feeds/i }), FEED.enteredUrl)
    await user.keyboard('{Enter}')

    expect(await screen.findByText('Field Notes')).toBeDefined()
    expect(screen.getByText('feeds.example')).toBeDefined()
    expect(screen.getByRole('img', { name: /items from Field Notes in the last 30 days/i })).toBeDefined()
    expect(container.querySelectorAll('.cadence-day')).toHaveLength(30)
    expect(api.requestsTo('POST /api/subscriptions')).toMatchObject([{ body: { url: FEED.enteredUrl } }])
  })

  it('treats a line that is not a URL as a search, never as something to submit', async () => {
    const api = stubApi().on('GET /api/feeds', {
      body: { subscriptions: [FEED, { ...FEED, feedId: 2, title: 'Other Wire', domain: 'wire.example' }] },
    })
    window.history.replaceState(null, '', '/feeds')
    render(<App />)
    const user = userEvent.setup()

    expect(await screen.findByText('Other Wire')).toBeDefined()
    await user.type(screen.getByRole('textbox', { name: /search or add feeds/i }), 'field{Enter}')

    expect(screen.getByText('Field Notes')).toBeDefined()
    expect(screen.queryByText('Other Wire')).toBeNull()
    expect(api.requestsTo('POST /api/subscriptions')).toHaveLength(0)

    await user.clear(screen.getByRole('textbox', { name: /search or add feeds/i }))
    expect(await screen.findByText('Other Wire')).toBeDefined()
  })

  it('says calmly when no Feed matches the search', async () => {
    stubApi().on('GET /api/feeds', { body: { subscriptions: [FEED] } })
    window.history.replaceState(null, '', '/feeds')
    render(<App />)
    const user = userEvent.setup()

    expect(await screen.findByText('Field Notes')).toBeDefined()
    await user.type(screen.getByRole('textbox', { name: /search or add feeds/i }), 'nothing like this')

    expect(await screen.findByText('no feeds match')).toBeDefined()
  })

  it('does not let a stale initial list replace a Subscription that just completed', async () => {
    let release: ((reply: Reply) => void) | undefined
    const staleList = new Promise<Reply>((resolve) => {
      release = resolve
    })
    stubApi()
      .on('GET /api/feeds', () => staleList)
      .on('POST /api/subscriptions', {
        status: 201,
        body: { subscription: FEED, importedItems: 1 },
      })
    window.history.replaceState(null, '', '/feeds')
    render(<App />)
    const user = userEvent.setup()

    await user.type(await screen.findByRole('textbox', { name: /search or add feeds/i }), FEED.enteredUrl)
    await user.keyboard('{Enter}')
    expect(await screen.findByText('Field Notes')).toBeDefined()

    release?.({ body: { subscriptions: [] } })
    await waitFor(() => expect(screen.getByText('Field Notes')).toBeDefined())
  })
  it('keeps a useful duplicate outcome in place', async () => {
    stubApi()
      .on('GET /api/feeds', { body: { subscriptions: [FEED] } })
      .on('POST /api/subscriptions', {
        status: 409,
        body: { error: { code: 'duplicate_subscription', message: 'Already subscribed' } },
      })
    window.history.replaceState(null, '', '/feeds')
    render(<App />)
    const user = userEvent.setup()

    await user.type(await screen.findByRole('textbox', { name: /search or add feeds/i }), FEED.enteredUrl)
    await user.keyboard('{Enter}')

    expect(await screen.findByText('already subscribed')).toBeDefined()
    expect(screen.getAllByText('Field Notes')).toHaveLength(1)
  })
})

describe('Feed Availability', () => {
  it('says nothing about a Subscription whose checking works', async () => {
    stubApi().on('GET /api/feeds', { body: { subscriptions: [FEED] } })
    window.history.replaceState(null, '', '/feeds')
    render(<App />)

    expect(await screen.findByText('Field Notes')).toBeDefined()
    expect(screen.queryByRole('button', { name: /retry now/i })).toBeNull()
  })

  it('surfaces a calm note with the failure category, last success, and a retry action', async () => {
    stubApi().on('GET /api/feeds', { body: { subscriptions: [UNAVAILABLE_FEED] } })
    window.history.replaceState(null, '', '/feeds')
    render(<App />)

    expect(await screen.findByText(/the publisher is answering with an error/i)).toBeDefined()
    expect(screen.getByText(/last reached/i)).toBeDefined()
    expect(screen.getByText(/items stay in your digest/i)).toBeDefined()
    expect(screen.getByRole('button', { name: /retry now/i })).toBeDefined()
    // The Subscription itself is presented as usual, not as a problem row.
    expect(screen.getByText('Field Notes')).toBeDefined()
  })

  it('retries by hand and shows the restored Subscription at once', async () => {
    const api = stubApi().on('GET /api/feeds', { body: { subscriptions: [UNAVAILABLE_FEED] } })
    api.on('POST /api/feeds/1/refresh', () => {
      // The successful retry is what makes the next list read available again.
      api.on('GET /api/feeds', { body: { subscriptions: [FEED] } })
      return { body: { observedItems: 2 } }
    })
    window.history.replaceState(null, '', '/feeds')
    render(<App />)
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: /retry now/i }))

    expect(await screen.findByText('the feed answered — availability restored')).toBeDefined()
    await waitFor(() => expect(screen.queryByRole('button', { name: /retry now/i })).toBeNull())
    expect(api.requestsTo('POST /api/feeds/1/refresh')).toHaveLength(1)
  })

  it('explains a retry the server asked to wait on', async () => {
    stubApi()
      .on('GET /api/feeds', { body: { subscriptions: [UNAVAILABLE_FEED] } })
      .on('POST /api/feeds/1/refresh', {
        status: 429,
        headers: { 'retry-after': '42' },
        body: { error: { code: 'refresh_rate_limited', message: 'Wait before refreshing this Feed again' } },
      })
    window.history.replaceState(null, '', '/feeds')
    render(<App />)
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: /retry now/i }))

    expect(await screen.findByText('checked a moment ago — wait a little before retrying')).toBeDefined()
    // The note stays, because nothing about the Feed changed.
    expect(screen.getByRole('button', { name: /retry now/i })).toBeDefined()
  })
})

describe('OPML portability', () => {
  const OPML = '<opml version="2.0"><body><outline xmlUrl="https://journal.example/feed"/></body></opml>'

  it('imports an OPML file and reports each Feed as added, skipped, or failed', async () => {
    const api = stubApi()
      .on('POST /api/subscriptions/import', {
        body: {
          feeds: [
            { url: 'https://journal.example/feed', outcome: 'added', title: 'Field Notes', reason: null },
            { url: 'https://old.example/feed', outcome: 'skipped', title: 'Old Friend', reason: 'already subscribed' },
            {
              url: 'https://gone.example/feed',
              outcome: 'failed',
              title: null,
              reason: 'The Feed could not be reached',
            },
          ],
        },
      })
    window.history.replaceState(null, '', '/feeds')
    render(<App />)
    const user = userEvent.setup()

    api.on('GET /api/feeds', { body: { subscriptions: [FEED] } })
    const file = new File([OPML], 'subscriptions.opml', { type: 'text/x-opml' })
    await user.upload(await screen.findByLabelText(/import opml/i), file)

    expect(await screen.findByText('imported — 1 added, 1 skipped, 1 failed')).toBeDefined()
    expect(screen.getByText(/old friend — already subscribed/i)).toBeDefined()
    expect(screen.getByText(/gone\.example\/feed — the feed could not be reached/i)).toBeDefined()
    expect(api.requestsTo('POST /api/subscriptions/import')).toMatchObject([{ body: { opml: OPML } }])
    // The list is refetched, so the added Subscriptions appear.
    expect(await screen.findByText('Field Notes')).toBeDefined()
  })

  it('explains an upload the server refused', async () => {
    stubApi().on('POST /api/subscriptions/import', {
      status: 422,
      body: { error: { code: 'unsupported_opml', message: 'The file is not an OPML subscription list' } },
    })
    window.history.replaceState(null, '', '/feeds')
    render(<App />)
    // `applyAccept` off: this test hands the reader exactly the file the
    // picker's filter would discourage, because the server still must refuse it.
    const user = userEvent.setup({ applyAccept: false })

    const file = new File(['not xml'], 'notes.txt', { type: 'text/plain' })
    await user.upload(await screen.findByLabelText(/import opml/i), file)

    expect(await screen.findByText('that file is not an OPML subscription list')).toBeDefined()
  })

  it('keeps both controls reachable by keyboard', async () => {
    stubApi()
    window.history.replaceState(null, '', '/feeds')
    render(<App />)
    const user = userEvent.setup()

    await user.click(await screen.findByRole('textbox', { name: /search or add feeds/i }))
    // The search/add control submits itself, so the next stops are the import
    // input and the export link.
    await user.tab()
    expect(document.activeElement).toBe(screen.getByLabelText(/import opml/i))
    await user.tab()
    expect(document.activeElement).toBe(screen.getByRole('link', { name: /export opml/i }))
  })

  it('offers the export as a plain same-origin download link', async () => {
    stubApi()
    window.history.replaceState(null, '', '/feeds')
    render(<App />)

    const link = (await screen.findByRole('link', { name: /export opml/i })) as HTMLAnchorElement
    expect(link.getAttribute('href')).toBe('/api/subscriptions/export')
    expect(link.getAttribute('download')).toBe('subscriptions.opml')
  })
})

describe('daily Digest band', () => {
  it('is stable for one date and changes with the date', () => {
    const first = dailyShadows('2026-08-08', 12, 20, 20)
    expect(dailyShadows('2026-08-08', 12, 20, 20)).toBe(first)
    expect(dailyShadows('2026-08-09', 12, 20, 20)).not.toBe(first)
  })
})
describe('Digest', () => {

  it('renders chronological date groups with the Feed, time, and save affordance', async () => {
    stubApi().on('GET /api/digest', {
      body: {
        today: { date: '2026-08-08', volume: 1 },
        groups: [
          {
            date: '2026-08-08',
            label: 'today',
            items: [
              {
                feedItemId: 1,
                title: 'First light',
                feedId: 1,
                feedTitle: 'Field Notes',
                link: 'https://journal.example/first-light',
                publishedAt: '2026-08-08T07:15:00.000Z',
                displayTime: '07:15',
                imageUrl: null,
                summary: 'A clear morning.',
                firstSeenAt: '2026-08-08T09:00:00.000Z',
                saved: false,
              },
            ],
          },
        ],
      },
    })
    window.history.replaceState(null, '', '/digest')
    const { container } = render(<App />)

    expect(await screen.findByRole('heading', { name: 'today · 1 post' })).toBeDefined()
    expect(screen.getByRole('heading', { name: 'First light' })).toBeDefined()
    expect(screen.getByText('Field Notes')).toBeDefined()
    expect(container.querySelectorAll('.daily-band-field')).toHaveLength(1)
    expect(screen.getByText('07:15')).toBeDefined()
    expect(screen.getByRole('button', { name: /save first light/i }).textContent).toBe('save')
    await waitFor(() => expect(container.textContent).not.toMatch(/unread/i))
  })

  it('keeps the zero-volume daily band when the newest item is older than today', async () => {
    stubApi().on('GET /api/digest', {
      body: {
        today: { date: '2026-08-08', volume: 0 },
        groups: [
          {
            date: '2026-08-07',
            label: 'yesterday',
            items: [
              {
                feedItemId: 1,
                title: 'Yesterday',
                feedId: 1,
                feedTitle: 'Field Notes',
                link: null,
                publishedAt: '2026-08-07T07:15:00.000Z',
                displayTime: '07:15',
                imageUrl: null,
                summary: null,
                firstSeenAt: '2026-08-07T09:00:00.000Z',
                saved: false,
              },
            ],
          },
        ],
      },
    })
    window.history.replaceState(null, '', '/digest')
    const { container } = render(<App />)

    await screen.findByRole('heading', { name: 'yesterday' })
    expect(container.querySelector('.daily-band')).not.toBeNull()
  })
})
