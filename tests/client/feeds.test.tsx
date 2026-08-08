import { render, screen, waitFor } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App } from '../../src/client/app.js'
import { dailyShadows } from '../../src/client/components/daily-band.js'
import { stubApi, type Reply } from './stub-api.js'

const FEED = {
  feedId: 1,
  title: 'Field Notes',
  domain: 'feeds.example',
  enteredUrl: 'https://journal.example/feed',
  resolvedUrl: 'https://feeds.example/journal.xml',
  cadence: Array.from({ length: 30 }, () => 0),
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('Feeds', () => {
  it('accepts an exact Feed URL and shows the accepted Feed shape immediately', async () => {
    const api = stubApi()
      .on('GET /api/feeds', { body: { subscriptions: [] } })
      .on('POST /api/subscriptions', {
        status: 201,
        body: { subscription: FEED, importedItems: 1 },
      })
    window.history.replaceState(null, '', '/feeds')
    const { container } = render(<App />)
    const user = userEvent.setup()

    await user.type(await screen.findByRole('textbox', { name: /exact rss or atom url/i }), FEED.enteredUrl)
    await user.click(screen.getByRole('button', { name: 'subscribe' }))

    expect(await screen.findByText('Field Notes')).toBeDefined()
    expect(screen.getByText('feeds.example')).toBeDefined()
    expect(screen.getByRole('img', { name: /items from Field Notes in the last 30 days/i })).toBeDefined()
    expect(container.querySelectorAll('.cadence-day')).toHaveLength(30)
    expect(api.requestsTo('POST /api/subscriptions')).toMatchObject([{ body: { url: FEED.enteredUrl } }])
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

    await user.type(await screen.findByRole('textbox', { name: /exact rss or atom url/i }), FEED.enteredUrl)
    await user.click(screen.getByRole('button', { name: 'subscribe' }))
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

    await user.type(await screen.findByRole('textbox', { name: /exact rss or atom url/i }), FEED.enteredUrl)
    await user.click(screen.getByRole('button', { name: 'subscribe' }))

    expect(await screen.findByText('already subscribed')).toBeDefined()
    expect(screen.getAllByText('Field Notes')).toHaveLength(1)
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

  it('renders chronological date groups with the Feed, time, and save placeholder', async () => {
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
              },
            ],
          },
        ],
      },
    })
    window.history.replaceState(null, '', '/digest')
    const { container } = render(<App />)

    expect(await screen.findByRole('heading', { name: 'today' })).toBeDefined()
    expect(screen.getByRole('heading', { name: 'First light' })).toBeDefined()
    expect(screen.getByText('Field Notes')).toBeDefined()
    expect(container.querySelectorAll('.daily-band-field')).toHaveLength(2)
    expect(screen.getByText('07:15')).toBeDefined()
    expect((screen.getByRole('button', { name: /save first light/i }) as HTMLButtonElement).disabled).toBe(true)
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
