import { act, render, screen, waitFor } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { FeedAvailability } from '../../src/shared/api.js'
import { App } from '../../src/client/app.js'
import { stubApi, type Reply } from './stub-api.js'

const AVAILABLE = {
  state: 'available',
  lastCheckedAt: '2026-08-08T09:00:00.000Z',
  lastSuccessAt: '2026-08-08T09:00:00.000Z',
  consecutiveFailures: 0,
  category: null,
} satisfies FeedAvailability

const UNCHECKED = {
  state: 'unchecked',
  lastCheckedAt: null,
  lastSuccessAt: null,
  consecutiveFailures: 0,
  category: null,
} satisfies FeedAvailability

const FEED = {
  feedId: 1,
  title: 'Field Notes',
  description: null,
  domain: 'journal.example',
  homePageUrl: 'https://journal.example/',
  enteredUrl: 'https://journal.example/feed',
  resolvedUrl: 'https://feeds.example/journal.xml',
  readingSource: 'original-webpage',
  subscribedAt: '2026-08-01T09:00:00.000Z',
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
  } satisfies FeedAvailability,
}

function feedDetail(availability: FeedAvailability, itemCount: number) {
  return {
    feedId: FEED.feedId,
    title: FEED.title,
    description: null,
    reportedTitle: FEED.title,
    customTitle: null,
    reportedDescription: null,
    customDescription: null,
    domain: FEED.domain,
    homePageUrl: FEED.homePageUrl,
    enteredUrl: FEED.enteredUrl,
    resolvedUrl: FEED.resolvedUrl,
    availability,
    schedule: { pollingIntervalMinutes: 120, nextPollAt: '2026-08-08T11:00:00.000Z' },
    readingSource: 'original-webpage',
    subscribedDate: '2026-08-01',
    cadence: [],
    items: Array.from({ length: itemCount }, (_, index) => ({
      feedItemId: index + 1,
      title: `Item ${index + 1}`,
      link: null,
      publishedAt: null,
      firstSeenAt: '2026-08-08T09:00:00.000Z',
      date: '2026-08-08',
      displayTime: '09:00',
      saved: false,
    })),
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

type User = ReturnType<typeof userEvent.setup>

async function addByAddress(user: User, address: string) {
  await user.click(await screen.findByRole('button', { name: 'Add feed' }))
  await user.type(await screen.findByRole('textbox', { name: 'URL' }), address)
  await user.keyboard('{Enter}')
}

async function importFile(user: User, file: File) {
  await user.click(await screen.findByRole('button', { name: 'Add feed' }))
  await user.click(await screen.findByRole('button', { name: 'Import OPML' }))
  await user.upload(screen.getByLabelText(/choose a file/i), file)
  await user.click(screen.getByRole('button', { name: 'Import' }))
}

/** Thirty days of Cadence with items on the first `active` of them. */
function activeOn(active: number): number[] {
  return Array.from({ length: 30 }, (_, index) => (index < active ? 1 : 0))
}

describe('Feeds', () => {
  it('shows the recorded Subscription immediately and the first check outcome as it lands', async () => {
    let releaseDetail: ((reply: Reply) => void) | undefined
    const firstCheck = new Promise<Reply>((resolve) => {
      releaseDetail = resolve
    })
    const api = stubApi().on('GET /api/feeds', { body: { subscriptions: [] } })
    api.on('POST /api/subscriptions', () => {
      api.on('GET /api/feeds/1', () => firstCheck)
      api.on('GET /api/feeds', { body: { subscriptions: [UNCHECKED_FEED] } })
      return { status: 201, body: { subscription: UNCHECKED_FEED } }
    })
    window.history.replaceState(null, '', '/feeds')
    const { container } = render(<App />)
    const user = userEvent.setup()

    await addByAddress(user, FEED.enteredUrl)

    expect((await screen.findAllByText('journal.example')).length).toBeGreaterThan(0)
    expect(screen.getByText('Subscribed. Checking the feed…')).toBeDefined()
    expect(screen.getByText('Waiting for first check')).toBeDefined()

    api.on('GET /api/feeds', { body: { subscriptions: [FEED] } })
    releaseDetail?.({ body: feedDetail(AVAILABLE, 1) })
    expect(await screen.findByText('Subscribed. 1 item in the digest.')).toBeDefined()
    expect(await screen.findByText('Field Notes')).toBeDefined()
    expect(container.querySelectorAll('.cadence-day')).toHaveLength(30)
    expect(api.requestsTo('POST /api/subscriptions')).toMatchObject([{ body: { url: FEED.enteredUrl } }])
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

  it('says in the same breath when the first check finds the URL wrong', async () => {
    const api = stubApi().on('GET /api/feeds', { body: { subscriptions: [] } })
    api.on('POST /api/subscriptions', () => {
      api.on('GET /api/feeds/1', {
        body: feedDetail({ ...UNCHECKED, consecutiveFailures: 1, category: 'unreachable' }, 0),
      })
      api.on('GET /api/feeds', {
        body: {
          subscriptions: [
            { ...UNCHECKED_FEED, availability: { ...UNCHECKED, consecutiveFailures: 1, category: 'unreachable' } },
          ],
        },
      })
      return { status: 201, body: { subscription: UNCHECKED_FEED } }
    })
    window.history.replaceState(null, '', '/feeds')
    render(<App />)
    const user = userEvent.setup()

    await addByAddress(user, FEED.enteredUrl)

    expect(await screen.findByText('That feed couldn’t be reached.')).toBeDefined()
  })

  it('reads a Subscription that merged away during its first check as already subscribed', async () => {
    const api = stubApi().on('GET /api/feeds', { body: { subscriptions: [FEED] } })
    api.on('POST /api/subscriptions', () => {
      api.on('GET /api/feeds/2', { status: 404, body: { error: { code: 'not_found', message: 'Not found' } } })
      return {
        status: 201,
        body: { subscription: { ...UNCHECKED_FEED, feedId: 2, enteredUrl: 'https://alias.example/feed' } },
      }
    })
    window.history.replaceState(null, '', '/feeds')
    render(<App />)
    const user = userEvent.setup()

    await addByAddress(user, 'https://alias.example/feed')

    expect(await screen.findByText('Already subscribed.')).toBeDefined()
    await waitFor(() => expect(screen.getAllByText('Field Notes')).toHaveLength(1))
  })

  it('refuses a line that is no address in the dialog, never with a request', async () => {
    const api = stubApi().on('GET /api/feeds', { body: { subscriptions: [FEED] } })
    window.history.replaceState(null, '', '/feeds')
    render(<App />)
    const user = userEvent.setup()

    await addByAddress(user, 'field notes')

    expect(await screen.findByText('Enter a site or feed address, like lowtechmagazine.com.')).toBeDefined()
    expect(screen.getByRole('dialog', { name: 'Add feed' })).toBeDefined()
    expect(api.requestsTo('POST /api/subscriptions')).toHaveLength(0)
  })

  it('gives a bare site address https://, since the server finds a site’s feed', async () => {
    const api = stubApi()
      .on('GET /api/feeds', { body: { subscriptions: [] } })
      .on('POST /api/subscriptions', { status: 201, body: { subscription: FEED } })
      .on('GET /api/feeds/1', { body: feedDetail(AVAILABLE, 0) })
    window.history.replaceState(null, '', '/feeds')
    render(<App />)
    const user = userEvent.setup()

    await addByAddress(user, 'journal.example')

    await waitFor(() =>
      expect(api.requestsTo('POST /api/subscriptions')).toMatchObject([{ body: { url: 'https://journal.example' } }]),
    )
  })

  it('does not let a stale initial list replace a Subscription that just completed', async () => {
    let release: ((reply: Reply) => void) | undefined
    const staleList = new Promise<Reply>((resolve) => {
      release = resolve
    })
    const api = stubApi()
      .on('GET /api/feeds', () => {
        api.on('GET /api/feeds', { body: { subscriptions: [FEED] } })
        return staleList
      })
      .on('GET /api/feeds/1', { body: feedDetail(AVAILABLE, 1) })
      .on('POST /api/subscriptions', {
        status: 201,
        body: { subscription: FEED },
      })
    window.history.replaceState(null, '', '/feeds')
    render(<App />)
    const user = userEvent.setup()

    await addByAddress(user, FEED.enteredUrl)
    expect(await screen.findByText('Field Notes')).toBeDefined()

    release?.({ body: { subscriptions: [] } })
    await act(() => new Promise((resolve) => setTimeout(resolve, 0)))
    expect(screen.getByText('Field Notes')).toBeDefined()
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

    await addByAddress(user, FEED.enteredUrl)

    expect(await screen.findByText('Already subscribed.')).toBeDefined()
    expect(screen.getByRole('dialog', { name: 'Add feed' })).toBeDefined()
    expect(screen.getAllByText('Field Notes')).toHaveLength(1)
  })
})

describe('the Feeds list', () => {
  it('groups Subscriptions by Rhythm, and folds a long group behind Show N more and back', async () => {
    const daily = Array.from({ length: 8 }, (_, index) => ({
      ...FEED,
      feedId: index + 10,
      title: `Daily ${index + 1}`,
      cadence: activeOn(20),
    }))
    stubApi().on('GET /api/feeds', {
      body: { subscriptions: [...daily, { ...FEED, title: 'Quiet', cadence: activeOn(0) }] },
    })
    window.history.replaceState(null, '', '/feeds')
    render(<App />)
    const user = userEvent.setup()

    expect(await screen.findByRole('heading', { level: 1, name: 'Feeds 9' })).toBeDefined()
    expect(screen.getByRole('heading', { name: 'Daily 8' })).toBeDefined()
    expect(screen.getByRole('heading', { name: 'Inactive 1' })).toBeDefined()
    expect(screen.queryByRole('heading', { name: /^Weekly/ })).toBeNull()
    expect(screen.queryByRole('link', { name: 'Daily 7' })).toBeNull()

    await user.click(screen.getByRole('button', { name: 'Show 2 more' }))

    expect(screen.getByRole('link', { name: 'Daily 7' })).toBeDefined()
    expect(screen.queryByRole('button', { name: /more/ })).toBeNull()

    await user.click(screen.getByRole('button', { name: 'Show fewer' }))

    expect(screen.queryByRole('link', { name: 'Daily 7' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Show 2 more' })).toBeDefined()
  })

  it('lists every Subscription by name on request', async () => {
    stubApi().on('GET /api/feeds', {
      body: {
        subscriptions: [
          { ...FEED, feedId: 1, title: 'Wire', cadence: activeOn(20) },
          { ...FEED, feedId: 2, title: 'Almanac', cadence: activeOn(0) },
        ],
      },
    })
    window.history.replaceState(null, '', '/feeds')
    render(<App />)
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'By name' }))

    const names = screen.getAllByRole('heading', { level: 3 }).map((heading) => heading.textContent)
    expect(names).toEqual(['Almanac', 'Wire'])
    expect(screen.queryByRole('heading', { name: /^Daily/ })).toBeNull()
  })

  it('lists the newest Subscription first under Recently added', async () => {
    stubApi().on('GET /api/feeds', {
      body: {
        subscriptions: [
          { ...FEED, feedId: 1, title: 'Almanac', subscribedAt: '2026-03-01T09:00:00.000Z' },
          { ...FEED, feedId: 2, title: 'Wire', subscribedAt: '2026-08-07T09:00:00.000Z' },
        ],
      },
    })
    window.history.replaceState(null, '', '/feeds')
    render(<App />)
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'Recently added' }))

    const names = screen.getAllByRole('heading', { level: 3 }).map((heading) => heading.textContent)
    expect(names).toEqual(['Wire', 'Almanac'])
  })
})

describe('Feed Availability', () => {
  it('says nothing about a Subscription whose checking works', async () => {
    stubApi().on('GET /api/feeds', { body: { subscriptions: [FEED] } })
    window.history.replaceState(null, '', '/feeds')
    render(<App />)

    expect(await screen.findByText('Field Notes')).toBeDefined()
    expect(screen.queryByRole('button', { name: /^Retry$/ })).toBeNull()
    expect(screen.queryByText(/waiting for first check/i)).toBeNull()
  })

  it('notes a Subscription still waiting for its first check', async () => {
    stubApi().on('GET /api/feeds', { body: { subscriptions: [UNCHECKED_FEED] } })
    window.history.replaceState(null, '', '/feeds')
    render(<App />)

    expect((await screen.findAllByText('journal.example')).length).toBeGreaterThan(0)
    expect(await screen.findByText('Waiting for first check')).toBeDefined()
    expect(screen.queryByRole('button', { name: /^Retry$/ })).toBeNull()
  })

  it('surfaces a calm note with the failure category, last success, and a retry action', async () => {
    stubApi().on('GET /api/feeds', { body: { subscriptions: [UNAVAILABLE_FEED] } })
    window.history.replaceState(null, '', '/feeds')
    render(<App />)

    expect(await screen.findByText(/the publisher is answering with an error/i)).toBeDefined()
    expect(screen.getByText(/last reached/i)).toBeDefined()
    expect(screen.getByText(/items stay in your digest/i)).toBeDefined()
    expect(screen.getByRole('button', { name: /^Retry$/ })).toBeDefined()
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

    await user.click(await screen.findByRole('button', { name: /^Retry$/ }))

    expect(await screen.findByText('The feed answered. Checking works again.')).toBeDefined()
    await waitFor(() => expect(screen.queryByRole('button', { name: /^Retry$/ })).toBeNull())
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

    await user.click(await screen.findByRole('button', { name: /^Retry$/ }))

    expect(await screen.findByText('Checked a moment ago. Wait a little before retrying.')).toBeDefined()
    expect(screen.getByRole('button', { name: /^Retry$/ })).toBeDefined()
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
    await importFile(user, file)

    expect(await screen.findByText('Imported: 2 added, 1 already subscribed.')).toBeDefined()
    expect(screen.getByText(/not a url: not a usable feed address/i)).toBeDefined()
    expect(api.requestsTo('POST /api/subscriptions/import')).toMatchObject([{ body: { opml: OPML } }])
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
    await importFile(user, file)

    expect(await screen.findByText('That file isn’t an OPML subscription list.')).toBeDefined()
  })

  it('offers the export as a plain same-origin download link', async () => {
    stubApi().on('GET /api/feeds', { body: { subscriptions: [FEED] } })
    window.history.replaceState(null, '', '/feeds')
    render(<App />)

    const link = (await screen.findByRole('link', { name: /export/i })) as HTMLAnchorElement
    expect(link.getAttribute('href')).toBe('/api/subscriptions/export')
    expect(link.getAttribute('download')).toBe('subscriptions.opml')
  })

  it('offers no export before there is a Subscription to export', async () => {
    stubApi()
    window.history.replaceState(null, '', '/feeds')
    render(<App />)

    expect(await screen.findByText(/^No feeds yet\./)).toBeDefined()
    expect(screen.queryByRole('link', { name: /export/i })).toBeNull()
  })
})
