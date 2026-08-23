import { act, render, screen, waitFor } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App } from '../../src/client/app.js'
import { dailyShadows } from '../../src/client/components/daily-band.js'
import { subscribedNotice } from '../../src/client/views/feed-language.js'
import { stubApi, type Reply } from './stub-api.js'

const AVAILABLE = {
  state: 'available',
  lastCheckedAt: '2026-08-08T09:00:00.000Z',
  lastSuccessAt: '2026-08-08T09:00:00.000Z',
  consecutiveFailures: 0,
  category: null,
}

const UNCHECKED = {
  state: 'unchecked',
  lastCheckedAt: null,
  lastSuccessAt: null,
  consecutiveFailures: 0,
  category: null,
}

const FEED = {
  feedId: 1,
  title: 'Field Notes',
  description: null,
  domain: 'journal.example',
  homePageUrl: 'https://journal.example/',
  enteredUrl: 'https://journal.example/feed',
  resolvedUrl: 'https://feeds.example/journal.xml',
  cadence: Array.from({ length: 30 }, () => 0),
  availability: AVAILABLE,
}

const UNCHECKED_FEED = {
  ...FEED,
  title: 'journal.example',
  homePageUrl: null,
  resolvedUrl: FEED.enteredUrl,
  availability: UNCHECKED,
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
  vi.useRealTimers()
})

/**
 * Vitest's fake clock, with Testing Library told how to advance it: its waits
 * drain through a zero timer it only knows how to fire on Jest's clock. Returns
 * what `userEvent.setup` needs to wait on the same clock.
 */
function useFakeClock(): { advanceTimers: (milliseconds: number) => void } {
  const advanceTimers = (milliseconds: number) => void vi.advanceTimersByTime(milliseconds)
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  vi.stubGlobal('jest', { advanceTimersByTime: advanceTimers })
  return { advanceTimers }
}

function elapse(milliseconds: number): Promise<void> {
  return act(async () => {
    await vi.advanceTimersByTimeAsync(milliseconds)
  })
}

const PREVIEW = {
  url: FEED.enteredUrl,
  title: 'Field Notes',
  description: 'Notes from the field',
  domain: 'journal.example',
  homePageUrl: 'https://journal.example/',
  items: [
    {
      title: 'First light',
      link: 'https://journal.example/first-light',
      publishedAt: '2026-08-08T07:15:00.000Z',
      displayDate: 'today',
    },
    { title: 'Undated note', link: null, publishedAt: null, displayDate: 'undated' },
  ],
  declaredFeeds: [],
  subscribed: null,
}

const FIELD = { name: /search or add feeds/i }

async function submitUrl(url: string) {
  const user = userEvent.setup()
  await user.type(await screen.findByRole('textbox', FIELD), url)
  await user.keyboard('{Enter}')
  return user
}

describe('Feeds', () => {
  it('opens the preview in progress as soon as a URL is submitted, and stop abandons it', async () => {
    const api = stubApi().on('POST /api/feeds/preview', () => new Promise(() => {}))
    window.history.replaceState(null, '', '/feeds')
    render(<App />)

    const user = await submitUrl(FEED.enteredUrl)

    const dialog = await screen.findByRole('dialog', { name: 'previewing journal.example' })
    expect(dialog.textContent).toContain('reading the feed — this can take a few seconds')
    expect(api.requestsTo('POST /api/feeds/preview')).toMatchObject([{ body: { url: FEED.enteredUrl } }])

    await user.click(screen.getByRole('button', { name: 'stop' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(api.requestsTo('POST /api/feeds/preview')[0]?.signal?.aborted).toBe(true)
    expect(document.activeElement).toBe(screen.getByRole('textbox', FIELD))
    expect(screen.getByRole('textbox', FIELD)).toHaveProperty('value', FEED.enteredUrl)
  })

  it('asks subscribe to <title>? with the host, the description, and the recent items', async () => {
    const api = stubApi().on('POST /api/feeds/preview', { body: PREVIEW })
    window.history.replaceState(null, '', '/feeds')
    render(<App />)

    await submitUrl(FEED.enteredUrl)

    const dialog = await screen.findByRole('dialog', { name: 'subscribe to Field Notes?' })
    expect(dialog.textContent).toContain('journal.example — Notes from the field')
    expect(dialog.textContent).toContain('recent items')
    expect(dialog.textContent).toContain('First light')
    expect(dialog.textContent).toContain('today')
    expect(dialog.textContent).toContain('Undated note')
    expect(dialog.textContent).toContain('undated')
    expect(screen.getByRole('button', { name: 'subscribe' })).toBeDefined()
    expect(screen.getByRole('button', { name: 'cancel' })).toBeDefined()
    expect(api.requestsTo('POST /api/subscriptions')).toHaveLength(0)
  })

  it('says the host alone when the Feed has no description', async () => {
    stubApi().on('POST /api/feeds/preview', { body: { ...PREVIEW, description: null } })
    window.history.replaceState(null, '', '/feeds')
    render(<App />)

    await submitUrl(FEED.enteredUrl)

    const dialog = await screen.findByRole('dialog', { name: 'subscribe to Field Notes?' })
    expect(dialog.querySelector('.overlay-description')?.textContent).toBe('journal.example')
  })

  it('offers open feed instead of subscribe when the Feed is already subscribed', async () => {
    const api = stubApi()
      .on('GET /api/feeds', { body: { subscriptions: [FEED] } })
      .on('POST /api/feeds/preview', { body: { ...PREVIEW, subscribed: { feedId: 1 } } })
    window.history.replaceState(null, '', '/feeds')
    render(<App />)

    const user = await submitUrl(FEED.enteredUrl)

    await screen.findByRole('dialog', { name: 'already subscribed to Field Notes' })
    expect(screen.queryByRole('button', { name: 'subscribe' })).toBeNull()
    await user.click(screen.getByRole('button', { name: 'open feed' }))

    expect(window.location.pathname).toBe('/feeds/1')
    expect(api.requestsTo('POST /api/subscriptions')).toHaveLength(0)
  })

  it('offers the Declared Feeds of a page and re-previews in place when one is chosen', async () => {
    const PAGE_URL = 'https://journal.example/'
    const COMMENTS_URL = 'https://journal.example/comments/feed'
    const declaredFeeds = [
      { url: FEED.enteredUrl, title: 'Field Notes » Posts' },
      { url: COMMENTS_URL, title: null },
    ]
    let release: ((reply: Reply) => void) | undefined
    const api = stubApi().on('POST /api/feeds/preview', ({ body }) => {
      if ((body as { url: string }).url === PAGE_URL) return { body: { ...PREVIEW, declaredFeeds } }
      return new Promise<Reply>((resolve) => {
        release = resolve
      })
    })
    window.history.replaceState(null, '', '/feeds')
    render(<App />)

    const user = await submitUrl(PAGE_URL)

    const dialog = await screen.findByRole('dialog', { name: 'subscribe to Field Notes?' })
    expect(dialog.textContent).toContain('this page declares 2 feeds')
    expect(screen.getByRole('button', { name: 'Field Notes » Posts' })).toHaveProperty('disabled', true)

    await user.click(screen.getByRole('button', { name: '/comments/feed' }))

    expect(screen.getByRole('dialog', { name: 'previewing journal.example' })).toBeDefined()
    expect(api.requestsTo('POST /api/feeds/preview')).toMatchObject([
      { body: { url: PAGE_URL } },
      { body: { url: COMMENTS_URL } },
    ])

    release?.({ body: { ...PREVIEW, url: COMMENTS_URL, title: 'Field Notes » Comments', declaredFeeds: [] } })

    expect(await screen.findByRole('dialog', { name: 'subscribe to Field Notes » Comments?' })).toBeDefined()
    expect(screen.getByRole('button', { name: '/comments/feed' })).toHaveProperty('disabled', true)
    expect(screen.getByRole('button', { name: 'Field Notes » Posts' })).toHaveProperty('disabled', false)
  })

  it('shows no chooser for a page that declares one Feed', async () => {
    stubApi().on('POST /api/feeds/preview', {
      body: { ...PREVIEW, declaredFeeds: [{ url: FEED.enteredUrl, title: 'Field Notes » Posts' }] },
    })
    window.history.replaceState(null, '', '/feeds')
    render(<App />)

    await submitUrl('https://journal.example/')

    const dialog = await screen.findByRole('dialog', { name: 'subscribe to Field Notes?' })
    expect(dialog.textContent).not.toContain('this page declares')
    expect(screen.queryByRole('button', { name: 'Field Notes » Posts' })).toBeNull()
  })

  it('closes on a failed preview, says why under the field, and puts the cursor back in it', async () => {
    stubApi().on('POST /api/feeds/preview', {
      status: 422,
      body: { error: { code: 'no_feed_found', message: 'No Feed was found at that address' } },
    })
    window.history.replaceState(null, '', '/feeds')
    render(<App />)

    await submitUrl('https://journal.example/')

    expect(await screen.findByText('no feed was found at that address')).toBeDefined()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(screen.getByRole('textbox', FIELD))
    expect(screen.getByRole('textbox', FIELD)).toHaveProperty('value', 'https://journal.example/')
    expect(screen.getByText('no subscriptions yet')).toBeDefined()
  })

  it('subscribes from the dialog: both words disable while it is in flight, then the row and the notice arrive', async () => {
    let release: ((reply: Reply) => void) | undefined
    const api = stubApi()
      .on('POST /api/feeds/preview', { body: PREVIEW })
      .on(
        'POST /api/subscriptions',
        () =>
          new Promise<Reply>((resolve) => {
            release = resolve
          }),
      )
    window.history.replaceState(null, '', '/feeds')
    const { container } = render(<App />)

    const user = await submitUrl(FEED.enteredUrl)
    await user.click(await screen.findByRole('button', { name: 'subscribe' }))

    const subscribing = screen.getByRole('button', { name: 'subscribing…' })
    expect(subscribing.getAttribute('aria-disabled')).toBe('true')
    expect(screen.getByRole('button', { name: 'cancel' }).getAttribute('aria-disabled')).toBe('true')
    expect(document.activeElement).toBe(subscribing)
    await user.keyboard('{Escape}')
    expect(screen.getByRole('dialog')).toBeDefined()

    release?.({ status: 201, body: { subscription: FEED, observedItems: 1 } })

    expect(await screen.findByText('subscribed — 1 item in the digest')).toBeDefined()
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(screen.getByText('Field Notes')).toBeDefined()
    expect(container.querySelectorAll('.cadence-day')).toHaveLength(30)
    expect(screen.getByRole('textbox', FIELD)).toHaveProperty('value', '')
    expect(document.activeElement).toBe(screen.getByRole('textbox', FIELD))
    expect(api.requestsTo('POST /api/subscriptions')).toMatchObject([{ body: { url: PREVIEW.url } }])
    expect(api.requestsTo('GET /api/feeds/1')).toHaveLength(0)
  })

  it('counts the items in the plural', () => {
    expect(subscribedNotice(12)).toBe('subscribed — 12 items in the digest')
    expect(subscribedNotice(0)).toBe('subscribed — 0 items in the digest')
  })

  it('links the domain to the Feed’s home page, and leaves it plain text without one', async () => {
    const api = stubApi().on('GET /api/feeds', {
      body: {
        subscriptions: [FEED, { ...FEED, feedId: 2, title: 'Other Wire', domain: 'wire.example', homePageUrl: null }],
      },
    })
    window.history.replaceState(null, '', '/feeds')
    render(<App />)

    const link = await screen.findByRole('link', { name: 'journal.example' })
    expect(link.getAttribute('href')).toBe('https://journal.example/')
    expect(link.getAttribute('rel')).toBe('noopener noreferrer')
    expect(screen.getByText('wire.example').tagName).toBe('SPAN')
    expect(api.requestsTo('GET /api/feeds')).toHaveLength(1)
  })

  it('treats a line that is not a URL as a search, never as something to preview', async () => {
    const api = stubApi().on('GET /api/feeds', {
      body: { subscriptions: [FEED, { ...FEED, feedId: 2, title: 'Other Wire', domain: 'wire.example' }] },
    })
    window.history.replaceState(null, '', '/feeds')
    render(<App />)
    const user = userEvent.setup()

    expect(await screen.findByText('Other Wire')).toBeDefined()
    await user.type(screen.getByRole('textbox', FIELD), 'field{Enter}')

    expect(screen.getByText('Field Notes')).toBeDefined()
    expect(screen.queryByText('Other Wire')).toBeNull()
    expect(api.requestsTo('POST /api/feeds/preview')).toHaveLength(0)

    await user.clear(screen.getByRole('textbox', FIELD))
    expect(await screen.findByText('Other Wire')).toBeDefined()
  })

  it('finds a Feed by its effective description', async () => {
    stubApi().on('GET /api/feeds', {
      body: {
        subscriptions: [
          { ...FEED, description: 'read weekly' },
          { ...FEED, feedId: 2, title: 'Other Wire', domain: 'wire.example' },
        ],
      },
    })
    window.history.replaceState(null, '', '/feeds')
    render(<App />)
    const user = userEvent.setup()

    expect(await screen.findByText('Other Wire')).toBeDefined()
    await user.type(screen.getByRole('textbox', FIELD), 'weekly')

    expect(screen.getByText('Field Notes')).toBeDefined()
    expect(screen.queryByText('Other Wire')).toBeNull()
  })

  it('says calmly when no Feed matches the search', async () => {
    stubApi().on('GET /api/feeds', { body: { subscriptions: [FEED] } })
    window.history.replaceState(null, '', '/feeds')
    render(<App />)
    const user = userEvent.setup()

    expect(await screen.findByText('Field Notes')).toBeDefined()
    await user.type(screen.getByRole('textbox', FIELD), 'nothing like this')

    expect(await screen.findByText('no feeds match')).toBeDefined()
  })

  it('does not let a stale initial list replace a Subscription that just completed', async () => {
    let release: ((reply: Reply) => void) | undefined
    const staleList = new Promise<Reply>((resolve) => {
      release = resolve
    })
    stubApi()
      .on('GET /api/feeds', () => staleList)
      .on('POST /api/feeds/preview', { body: PREVIEW })
      .on('POST /api/subscriptions', { status: 201, body: { subscription: FEED, observedItems: 1 } })
    window.history.replaceState(null, '', '/feeds')
    render(<App />)

    const user = await submitUrl(FEED.enteredUrl)
    await user.click(await screen.findByRole('button', { name: 'subscribe' }))
    expect(await screen.findByText('Field Notes')).toBeDefined()

    release?.({ body: { subscriptions: [] } })
    await waitFor(() => expect(screen.getByText('Field Notes')).toBeDefined())
  })

  it('closes with already subscribed when subscribing loses the race', async () => {
    stubApi()
      .on('GET /api/feeds', { body: { subscriptions: [FEED] } })
      .on('POST /api/feeds/preview', { body: PREVIEW })
      .on('POST /api/subscriptions', {
        status: 409,
        body: { error: { code: 'duplicate_subscription', message: 'Already subscribed' } },
      })
    window.history.replaceState(null, '', '/feeds')
    render(<App />)

    const user = await submitUrl(FEED.enteredUrl)
    await user.click(await screen.findByRole('button', { name: 'subscribe' }))

    expect(await screen.findByText('already subscribed')).toBeDefined()
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
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
    expect(screen.queryByText(/waiting for first check/i)).toBeNull()
  })

  it('notes a Subscription still waiting for its first check', async () => {
    stubApi().on('GET /api/feeds', { body: { subscriptions: [UNCHECKED_FEED] } })
    window.history.replaceState(null, '', '/feeds')
    render(<App />)

    expect((await screen.findAllByText('journal.example')).length).toBeGreaterThan(0)
    expect(await screen.findByText('waiting for first check')).toBeDefined()
    expect(screen.queryByRole('button', { name: /retry now/i })).toBeNull()
  })

  it('keeps refreshing while a row is unchecked — after 3 s, 5 s, then every 10 s for as long as it takes — and stops once none is', async () => {
    useFakeClock()
    const api = stubApi().on('GET /api/feeds', { body: { subscriptions: [UNCHECKED_FEED] } })
    window.history.replaceState(null, '', '/feeds')
    render(<App />)
    expect(await screen.findByText('waiting for first check')).toBeDefined()
    const listReads = () => api.requestsTo('GET /api/feeds').length
    expect(listReads()).toBe(1)

    await elapse(2_999)
    expect(listReads()).toBe(1)
    await elapse(1)
    expect(listReads()).toBe(2)

    await elapse(4_999)
    expect(listReads()).toBe(2)
    await elapse(1)
    expect(listReads()).toBe(3)

    await elapse(9_999)
    expect(listReads()).toBe(3)
    await elapse(1)
    expect(listReads()).toBe(4)

    for (let round = 0; round < 25; round += 1) await elapse(10_000)
    expect(listReads()).toBe(29)

    api.on('GET /api/feeds', { body: { subscriptions: [FEED] } })
    await elapse(10_000)
    expect(listReads()).toBe(30)
    expect(screen.getByText('Field Notes')).toBeDefined()
    expect(screen.queryByText('waiting for first check')).toBeNull()

    await elapse(60_000)
    expect(listReads()).toBe(30)
  })

  it('surfaces a calm note with the failure category, last success, and a retry action', async () => {
    stubApi().on('GET /api/feeds', { body: { subscriptions: [UNAVAILABLE_FEED] } })
    window.history.replaceState(null, '', '/feeds')
    render(<App />)

    expect(await screen.findByText(/the publisher is answering with an error/i)).toBeDefined()
    expect(screen.getByText(/last reached/i)).toBeDefined()
    expect(screen.getByText(/items stay in your digest/i)).toBeDefined()
    expect(screen.getByRole('button', { name: /retry now/i })).toBeDefined()
    expect(screen.getByText('Field Notes')).toBeDefined()
  })

  it('retries by hand and shows the restored Subscription at once', async () => {
    const api = stubApi().on('GET /api/feeds', { body: { subscriptions: [UNAVAILABLE_FEED] } })
    api.on('POST /api/feeds/1/refresh', () => {
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

  it('says why a retry still failed, in the category the list speaks', async () => {
    const api = stubApi().on('GET /api/feeds', { body: { subscriptions: [UNAVAILABLE_FEED] } })
    api.on('POST /api/feeds/1/refresh', {
      status: 502,
      body: { error: { code: 'http_error', message: 'The publisher answered with an error' } },
    })
    window.history.replaceState(null, '', '/feeds')
    render(<App />)
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: /retry now/i }))

    expect(await screen.findByText('still unavailable — the publisher answered with an error')).toBeDefined()
    expect(screen.getByRole('button', { name: /retry now/i })).toBeDefined()
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
    expect(screen.getByRole('button', { name: /retry now/i })).toBeDefined()
  })
})

describe('OPML portability', () => {
  const OPML = '<opml version="2.0"><body><outline xmlUrl="https://journal.example/feed"/></body></opml>'

  it('imports an OPML file and reports the recorded counts with any unusable outlines', async () => {
    const api = stubApi().on('POST /api/subscriptions/import', {
      body: { added: 2, alreadySubscribed: 1, unusable: ['not a url'] },
    })
    window.history.replaceState(null, '', '/feeds')
    render(<App />)
    const user = userEvent.setup()

    api.on('GET /api/feeds', { body: { subscriptions: [FEED] } })
    const file = new File([OPML], 'subscriptions.opml', { type: 'text/x-opml' })
    await user.upload(await screen.findByLabelText(/import opml/i), file)

    expect(await screen.findByText('imported — 2 added, 1 already subscribed')).toBeDefined()
    expect(screen.getByText(/not a url — not a usable feed url/i)).toBeDefined()
    expect(api.requestsTo('POST /api/subscriptions/import')).toMatchObject([{ body: { opml: OPML } }])
    expect(await screen.findByText('Field Notes')).toBeDefined()
  })

  it('starts the refresh ladder over when an import reports', async () => {
    const clock = useFakeClock()
    const api = stubApi()
      .on('GET /api/feeds', { body: { subscriptions: [UNCHECKED_FEED] } })
      .on('POST /api/subscriptions/import', { body: { added: 1, alreadySubscribed: 0, unusable: [] } })
    window.history.replaceState(null, '', '/feeds')
    render(<App />)
    const user = userEvent.setup(clock)
    expect(await screen.findByText('waiting for first check')).toBeDefined()
    const listReads = () => api.requestsTo('GET /api/feeds').length

    await elapse(3_000)
    await elapse(5_000)
    expect(listReads()).toBe(3)

    const file = new File([OPML], 'subscriptions.opml', { type: 'text/x-opml' })
    await user.upload(screen.getByLabelText(/import opml/i), file)
    expect(await screen.findByText('imported — 1 added, 0 already subscribed')).toBeDefined()
    await elapse(0)
    expect(listReads()).toBe(4)

    await elapse(2_999)
    expect(listReads()).toBe(4)
    await elapse(1)
    expect(listReads()).toBe(5)
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
        nextCursor: null,
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
        nextCursor: null,
      },
    })
    window.history.replaceState(null, '', '/digest')
    const { container } = render(<App />)

    await screen.findByRole('heading', { name: 'yesterday' })
    expect(container.querySelector('.daily-band')).not.toBeNull()
  })
})
