import { act, render, screen, waitFor } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FeedPreviewResponse, SubscriptionList } from '../../src/shared/api.js'
import { App } from '../../src/client/app.js'
import { availability, feedPreview, subscription, UNCHECKED } from './fixtures.js'
import { stubApi, type Reply } from './stub-api.js'

const FEED = subscription()

const UNCHECKED_FEED = subscription({
  title: 'journal.example',
  homePageUrl: null,
  resolvedUrl: FEED.enteredUrl,
  availability: UNCHECKED,
})

const UNAVAILABLE_FEED = subscription({
  availability: availability({
    state: 'unavailable',
    lastSuccessDate: '2026-08-05',
    consecutiveFailures: 3,
    category: 'http_error',
  }),
})

const PREVIEWED = feedPreview()

const COMMENTS = feedPreview({
  feedUrl: 'https://journal.example/comments/feed',
  title: 'Comments on Field Notes',
  items: [{ title: 'On First light', publishedAt: '2026-08-07T12:00:00.000Z' }],
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

type User = ReturnType<typeof userEvent.setup>

/** Opens Add feed and pastes the address, which looks it up at once. */
async function lookUp(user: User, address: string) {
  await user.click(await screen.findByRole('button', { name: 'Add feed' }))
  await user.click(await screen.findByRole('textbox', { name: 'URL' }))
  await user.paste(address)
}

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

describe('Add feed', () => {
  // Noon on the fixtures' day, so every previewed instant is whole days away in any timezone.
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-08-08T12:00:00.000Z') })
  })

  it('opens the first of a page’s Feeds, and choosing another opens it instead', async () => {
    const api = stubApi().on('POST /api/subscriptions/preview', {
      body: { kind: 'page', host: 'journal.example', feeds: [PREVIEWED, COMMENTS] },
    })
    window.history.replaceState(null, '', '/feeds')
    render(<App />)
    const user = userEvent.setup()

    await lookUp(user, 'https://journal.example/')

    const group = await screen.findByRole('radiogroup', { name: 'journal.example names 2 feeds. Choose one.' })
    expect(group).toBeDefined()
    const first = screen.getByRole('radio', { name: 'Field Notes' })
    expect(first.getAttribute('aria-checked')).toBe('true')
    expect(screen.getByText('First light')).toBeDefined()
    expect(screen.queryByText('On First light')).toBeNull()

    first.focus()
    await user.keyboard('{ArrowDown}')

    expect(screen.getByRole('radio', { name: 'Comments on Field Notes' }).getAttribute('aria-checked')).toBe('true')
    expect(screen.getByText('On First light')).toBeDefined()
    expect(screen.queryByText('First light')).toBeNull()
    expect(api.requestsTo('POST /api/subscriptions/preview')).toMatchObject([
      { body: { url: 'https://journal.example/' } },
    ])
  })

  it('shows a lone Feed plainly: how lately and how often it publishes, its newest titles and its address', async () => {
    stubApi().on('POST /api/subscriptions/preview', {
      body: {
        kind: 'feed',
        feed: feedPreview({
          cadence: activeOn(5),
          lastItemAt: '2026-08-05T12:00:00.000Z',
          items: [{ title: 'First light', publishedAt: '2026-08-05T12:00:00.000Z' }],
        }),
      },
    })
    window.history.replaceState(null, '', '/feeds')
    render(<App />)
    const user = userEvent.setup()

    await lookUp(user, PREVIEWED.feedUrl)

    expect(await screen.findByText('Last item 3 days ago')).toBeDefined()
    expect(screen.getByText('Weekly')).toBeDefined()
    expect(screen.getByText('5 Aug')).toBeDefined()
    expect(screen.getByText('journal.example/feed')).toBeDefined()
    expect(screen.queryByRole('radio')).toBeNull()
    expect(screen.getByRole('button', { name: 'Subscribe' }).getAttribute('aria-disabled')).not.toBe('true')
  })

  it('warns that a Feed silent for months may have stopped publishing', async () => {
    const twoYearsAgo = '2024-08-01T12:00:00.000Z'
    stubApi().on('POST /api/subscriptions/preview', {
      body: {
        kind: 'feed',
        feed: feedPreview({ lastItemAt: twoYearsAgo, items: [{ title: 'Last word', publishedAt: twoYearsAgo }] }),
      },
    })
    window.history.replaceState(null, '', '/feeds')
    render(<App />)
    const user = userEvent.setup()

    await lookUp(user, PREVIEWED.feedUrl)

    expect(await screen.findByText('Last item 2 years ago')).toBeDefined()
    expect(screen.getByText('Nothing new in 2 years. It may have stopped publishing.')).toBeDefined()
    expect(screen.getByText('1 Aug 2024')).toBeDefined()
  })

  it('offers no Subscribe for a Feed already followed', async () => {
    stubApi().on('POST /api/subscriptions/preview', {
      body: { kind: 'feed', feed: feedPreview({ subscribed: true }) },
    })
    window.history.replaceState(null, '', '/feeds')
    render(<App />)
    const user = userEvent.setup()

    await lookUp(user, PREVIEWED.feedUrl)

    expect(await screen.findByText('You follow this')).toBeDefined()
    expect(screen.getByRole('button', { name: 'Already subscribed' }).getAttribute('aria-disabled')).toBe('true')
  })

  it('says when a page names no feed', async () => {
    stubApi().on('POST /api/subscriptions/preview', { body: { kind: 'page', host: 'journal.example', feeds: [] } })
    window.history.replaceState(null, '', '/feeds')
    render(<App />)
    const user = userEvent.setup()

    await lookUp(user, 'journal.example')

    expect(await screen.findByText('journal.example doesn’t name a feed. Try the feed’s own address.')).toBeDefined()
    expect(screen.getByRole('button', { name: 'Subscribe' }).getAttribute('aria-disabled')).toBe('true')
  })

  it('offers Retry when the address doesn’t answer, and nothing was added', async () => {
    const api = stubApi().on('POST /api/subscriptions/preview', {
      status: 502,
      body: { error: { code: 'feed_unreachable', message: 'Feed could not be reached' } },
    })
    window.history.replaceState(null, '', '/feeds')
    render(<App />)
    const user = userEvent.setup()

    await lookUp(user, 'journal.example')

    expect(await screen.findByText('journal.example couldn’t be reached. Nothing was added.')).toBeDefined()
    api.on('POST /api/subscriptions/preview', { body: { kind: 'feed', feed: PREVIEWED } })
    await user.click(screen.getByRole('button', { name: 'Retry' }))

    expect(await screen.findByText('First light')).toBeDefined()
    expect(api.requestsTo('POST /api/subscriptions/preview')).toHaveLength(2)
  })

  it('never shows the answer to an address that has since changed', async () => {
    const stale = Promise.withResolvers<Reply<FeedPreviewResponse>>()
    const api = stubApi().on('POST /api/subscriptions/preview', (request) =>
      JSON.stringify(request.body).includes('old.example') ? stale.promise : { body: { kind: 'feed', feed: COMMENTS } },
    )
    window.history.replaceState(null, '', '/feeds')
    render(<App />)
    const user = userEvent.setup()

    await lookUp(user, 'old.example')
    await user.clear(screen.getByRole('textbox', { name: 'URL' }))
    await user.paste('journal.example')
    stale.resolve({ body: { kind: 'feed', feed: PREVIEWED } })

    expect(await screen.findByText('On First light')).toBeDefined()
    await act(() => new Promise((resolve) => setTimeout(resolve, 0)))
    expect(screen.queryByText('First light')).toBeNull()
    expect(api.requestsTo('POST /api/subscriptions/preview')).toHaveLength(2)
  })

  it('subscribes to the chosen Feed, whose row simply arrives', async () => {
    const api = stubApi()
      .on('POST /api/subscriptions/preview', {
        body: { kind: 'page', host: 'journal.example', feeds: [COMMENTS, PREVIEWED] },
      })
      .on('POST /api/subscriptions', { status: 201, body: { subscription: FEED } })
    window.history.replaceState(null, '', '/feeds')
    render(<App />)
    const user = userEvent.setup()

    await lookUp(user, 'journal.example')
    await user.click(await screen.findByRole('radio', { name: 'Field Notes' }))
    await user.click(screen.getByRole('button', { name: 'Subscribe' }))

    expect(await screen.findByRole('link', { name: 'Field Notes' })).toBeDefined()
    expect(screen.queryByRole('dialog', { name: 'Add feed' })).toBeNull()
    expect(document.querySelector('.feeds-notices .note')?.textContent).toBe('')
    expect(api.requestsTo('POST /api/subscriptions')).toMatchObject([{ body: { url: PREVIEWED.feedUrl } }])
  })

  it('refuses a line that is no address in the dialog, never with a request', async () => {
    const api = stubApi().on('GET /api/feeds', { body: { subscriptions: [FEED] } })
    window.history.replaceState(null, '', '/feeds')
    render(<App />)
    const user = userEvent.setup()

    await addByAddress(user, 'field notes')

    expect(await screen.findByText('Enter a site or feed address, like lowtechmagazine.com.')).toBeDefined()
    expect(screen.getByRole('dialog', { name: 'Add feed' })).toBeDefined()
    expect(api.requestsTo('POST /api/subscriptions/preview')).toHaveLength(0)
  })

  it('looks up a bare site address with https:// on Enter', async () => {
    const api = stubApi().on('POST /api/subscriptions/preview', { body: { kind: 'feed', feed: PREVIEWED } })
    window.history.replaceState(null, '', '/feeds')
    render(<App />)
    const user = userEvent.setup()

    await addByAddress(user, 'journal.example')

    expect(await screen.findByText('First light')).toBeDefined()
    expect(api.requestsTo('POST /api/subscriptions/preview')).toMatchObject([
      { body: { url: 'https://journal.example' } },
    ])
  })

  it('keeps a refused Subscribe in the dialog', async () => {
    stubApi()
      .on('GET /api/feeds', { body: { subscriptions: [FEED] } })
      .on('POST /api/subscriptions/preview', { body: { kind: 'feed', feed: PREVIEWED } })
      .on('POST /api/subscriptions', {
        status: 409,
        body: { error: { code: 'duplicate_subscription', message: 'Already subscribed' } },
      })
    window.history.replaceState(null, '', '/feeds')
    render(<App />)
    const user = userEvent.setup()

    await lookUp(user, PREVIEWED.feedUrl)
    await user.click(await screen.findByRole('button', { name: 'Subscribe' }))

    expect(await screen.findByText('Already subscribed.')).toBeDefined()
    expect(screen.getByRole('dialog', { name: 'Add feed' })).toBeDefined()
  })

  it('does not let a stale initial list replace a Subscription that just completed', async () => {
    const staleList = Promise.withResolvers<Reply<SubscriptionList>>()
    const api = stubApi()
      .on('GET /api/feeds', () => {
        api.on('GET /api/feeds', { body: { subscriptions: [FEED] } })
        return staleList.promise
      })
      .on('POST /api/subscriptions/preview', { body: { kind: 'feed', feed: PREVIEWED } })
      .on('POST /api/subscriptions', { status: 201, body: { subscription: FEED } })
    window.history.replaceState(null, '', '/feeds')
    render(<App />)
    const user = userEvent.setup()

    await lookUp(user, PREVIEWED.feedUrl)
    await user.click(await screen.findByRole('button', { name: 'Subscribe' }))
    expect(await screen.findByRole('link', { name: 'Field Notes' })).toBeDefined()

    staleList.resolve({ body: { subscriptions: [] } })
    await act(() => new Promise((resolve) => setTimeout(resolve, 0)))
    expect(screen.getByRole('link', { name: 'Field Notes' })).toBeDefined()
  })
})

describe('Feeds', () => {
  it('links the domain to the Feed’s home page in a new tab, and leaves it plain text without one', async () => {
    const api = stubApi().on('GET /api/feeds', {
      body: {
        subscriptions: [FEED, { ...FEED, feedId: 2, title: 'Other Wire', domain: 'wire.example', homePageUrl: null }],
      },
    })
    window.history.replaceState(null, '', '/feeds')
    render(<App />)

    const link = await screen.findByRole('link', { name: 'journal.example (opens in a new tab)' })
    expect(link.getAttribute('href')).toBe('https://journal.example/')
    expect(link.getAttribute('rel')).toBe('noopener noreferrer')
    expect(screen.getByText('wire.example').tagName).toBe('SPAN')
    expect(api.requestsTo('GET /api/feeds')).toHaveLength(1)
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

  it('takes focus into the Rhythm group a jump reaches', async () => {
    stubApi().on('GET /api/feeds', {
      body: {
        subscriptions: [
          { ...FEED, title: 'Busy', cadence: activeOn(20) },
          { ...FEED, feedId: 2, title: 'Quiet', cadence: activeOn(0) },
        ],
      },
    })
    window.history.replaceState(null, '', '/feeds')
    render(<App />)
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: /^Inactive/ }))

    expect(document.activeElement).toBe(screen.getByRole('region', { name: 'Inactive 1' }))
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
