import { act, render, screen, waitFor, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CreateSubscriptionResponse, FeedPreviewResponse } from '../../src/shared/api.js'
import { App } from '../../src/client/app.js'
import { day, feedPreview, subscription, UNCHECKED, unavailable } from './fixtures.js'
import { stubApi, type Reply } from './stub-api.js'

const FEED = subscription()

const UNCHECKED_FEED = subscription({
  title: 'journal.example',
  homePageUrl: null,
  resolvedUrl: FEED.enteredUrl,
  availability: UNCHECKED,
})

const UNAVAILABLE_FEED = subscription({
  availability: unavailable(),
})

const PREVIEWED = feedPreview()

const COMMENTS = feedPreview({
  feedUrl: 'https://journal.example/comments/feed',
  title: 'Comments on Field Notes',
  items: [{ title: 'On First light', date: day('2026-08-07') }],
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

type User = ReturnType<typeof userEvent.setup>

const address = () => screen.findByRole<HTMLInputElement>('textbox', { name: 'Add a Feed' })

async function lookUp(user: User, line: string) {
  await user.click(await address())
  await user.paste(line)
}

async function addByAddress(user: User, line: string) {
  await user.type(await address(), line)
  await user.keyboard('{Enter}')
}

async function importFile(user: User, file: File) {
  await user.upload(await screen.findByLabelText('Import an OPML file'), file)
}

function openFeeds() {
  window.history.replaceState(null, '', '/feeds')
  return render(<App />)
}

function activeOn(active: number): number[] {
  return Array.from({ length: 30 }, (_, index) => (index < active ? 1 : 0))
}

describe('Add a Feed', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-08-08T12:00:00.000Z') })
  })

  it('chooses the first of a page’s Feeds, and choosing another shows it instead', async () => {
    const api = stubApi().on('POST /api/subscriptions/preview', {
      body: { kind: 'page', host: 'journal.example', feeds: [PREVIEWED, COMMENTS] },
    })
    openFeeds()
    const user = userEvent.setup()

    await lookUp(user, 'https://journal.example/')

    const choices = await screen.findByRole('group', { name: 'Feeds named by journal.example' })
    expect(within(choices).getByRole('button', { name: 'Field Notes' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByText('First light')).toBeDefined()
    expect(screen.queryByText('On First light')).toBeNull()

    await user.click(within(choices).getByRole('button', { name: 'Comments on Field Notes' }))

    expect(screen.getByText('On First light')).toBeDefined()
    expect(screen.queryByText('First light')).toBeNull()
    expect(api.requestsTo('POST /api/subscriptions/preview')).toMatchObject([
      { body: { url: 'https://journal.example/' } },
    ])
  })

  it('shows a lone Feed plainly: its Rhythm, how lately it published and its newest titles', async () => {
    stubApi().on('POST /api/subscriptions/preview', {
      body: {
        kind: 'feed',
        feed: feedPreview({
          cadence: activeOn(5),
          lastItemDate: day('2026-08-05'),
          items: [{ title: 'First light', date: day('2026-08-05') }],
        }),
      },
    })
    openFeeds()
    const user = userEvent.setup()

    await lookUp(user, PREVIEWED.feedUrl)

    expect(await screen.findByText('Weekly, last Feed Item 3 days ago')).toBeDefined()
    expect(screen.getByText('First light')).toBeDefined()
    expect(screen.queryByRole('group', { name: /Feeds named by/ })).toBeNull()
    expect(screen.getByRole('button', { name: 'Subscribe to Field Notes' }).getAttribute('aria-disabled')).not.toBe(
      'true',
    )
  })

  it('says how long a silent Feed has gone without a Feed Item', async () => {
    const twoYearsAgo = day('2024-08-01')
    stubApi().on('POST /api/subscriptions/preview', {
      body: {
        kind: 'feed',
        feed: feedPreview({ lastItemDate: twoYearsAgo, items: [{ title: 'Last word', date: twoYearsAgo }] }),
      },
    })
    openFeeds()
    const user = userEvent.setup()

    await lookUp(user, PREVIEWED.feedUrl)

    expect(await screen.findByText(/last Feed Item 2 years ago/)).toBeDefined()
  })

  it('offers no Subscribe for a Feed already followed', async () => {
    stubApi().on('POST /api/subscriptions/preview', {
      body: { kind: 'feed', feed: feedPreview({ subscribed: true }) },
    })
    openFeeds()
    const user = userEvent.setup()

    await lookUp(user, PREVIEWED.feedUrl)

    const held = await screen.findByRole('button', { name: 'Already among your Subscriptions' })
    expect(held.getAttribute('aria-disabled')).toBe('true')
  })

  it('says when a page names no Feed, and offers nothing to subscribe to', async () => {
    stubApi().on('POST /api/subscriptions/preview', { body: { kind: 'page', host: 'journal.example', feeds: [] } })
    openFeeds()
    const user = userEvent.setup()

    await lookUp(user, 'journal.example')

    expect(await screen.findByText('journal.example doesn’t name a feed. Try the feed’s own address.')).toBeDefined()
    expect(screen.queryByRole('button', { name: /^Subscribe/ })).toBeNull()
  })

  it('offers Retry when the address doesn’t answer, and nothing was added', async () => {
    const api = stubApi().on('POST /api/subscriptions/preview', {
      status: 502,
      body: { error: { code: 'feed_unreachable', message: 'Feed could not be reached' } },
    })
    openFeeds()
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
    openFeeds()
    const user = userEvent.setup()

    await lookUp(user, 'old.example')
    await user.clear(await address())
    await user.paste('journal.example')
    stale.resolve({ body: { kind: 'feed', feed: PREVIEWED } })

    expect(await screen.findByText('On First light')).toBeDefined()
    await act(() => new Promise((resolve) => setTimeout(resolve, 0)))
    expect(screen.queryByText('First light')).toBeNull()
    expect(api.requestsTo('POST /api/subscriptions/preview')).toHaveLength(2)
  })

  it('subscribes to the chosen Feed and opens it', async () => {
    const api = stubApi()
      .on('POST /api/subscriptions/preview', {
        body: { kind: 'page', host: 'journal.example', feeds: [COMMENTS, PREVIEWED] },
      })
      .on('POST /api/subscriptions', { status: 201, body: { subscription: FEED } })
    openFeeds()
    const user = userEvent.setup()

    await lookUp(user, 'journal.example')
    await user.click(await screen.findByRole('button', { name: 'Field Notes' }))
    await user.click(screen.getByRole('button', { name: 'Subscribe to Field Notes' }))

    await waitFor(() => expect(window.location.pathname).toBe('/feeds/1'))
    expect(api.requestsTo('POST /api/subscriptions')).toMatchObject([{ body: { url: PREVIEWED.feedUrl } }])
  })

  it('refuses a line that is no address, never with a request', async () => {
    const api = stubApi().on('GET /api/feeds', { body: { subscriptions: [FEED] } })
    openFeeds()
    const user = userEvent.setup()

    await addByAddress(user, 'field notes')

    expect(await screen.findByText('Enter a site or feed address, like lowtechmagazine.com.')).toBeDefined()
    expect(api.requestsTo('POST /api/subscriptions/preview')).toHaveLength(0)
  })

  it('looks up a bare site address with https:// on Enter', async () => {
    const api = stubApi().on('POST /api/subscriptions/preview', { body: { kind: 'feed', feed: PREVIEWED } })
    openFeeds()
    const user = userEvent.setup()

    await addByAddress(user, 'journal.example')

    expect(await screen.findByText('First light')).toBeDefined()
    expect(api.requestsTo('POST /api/subscriptions/preview')).toMatchObject([
      { body: { url: 'https://journal.example' } },
    ])
  })

  it('keeps a refused Subscribe on the screen and says why', async () => {
    stubApi()
      .on('GET /api/feeds', { body: { subscriptions: [FEED] } })
      .on('POST /api/subscriptions/preview', { body: { kind: 'feed', feed: PREVIEWED } })
      .on('POST /api/subscriptions', {
        status: 409,
        body: { error: { code: 'duplicate_subscription', message: 'Already subscribed' } },
      })
    openFeeds()
    const user = userEvent.setup()

    await lookUp(user, PREVIEWED.feedUrl)
    await user.click(await screen.findByRole('button', { name: 'Subscribe to Field Notes' }))

    expect(await screen.findByText('Already subscribed.')).toBeDefined()
    expect(window.location.pathname).toBe('/feeds')
  })

  it('says a line is no address once typing pauses, never with a request', async () => {
    const api = stubApi()
    openFeeds()
    const user = userEvent.setup()

    await user.type(await address(), 'field notes')

    expect(
      await screen.findByText('Enter a site or feed address, like lowtechmagazine.com.', {}, { timeout: 2000 }),
    ).toBeDefined()
    expect(api.requestsTo('POST /api/subscriptions/preview')).toHaveLength(0)
  })

  it('blames the reader, not the site, when the reader never answers', async () => {
    stubApi().on('POST /api/subscriptions/preview', () => {
      throw new TypeError('Failed to fetch')
    })
    openFeeds()
    const user = userEvent.setup()

    await lookUp(user, 'journal.example')

    expect(await screen.findByText('Can’t reach simple. Nothing was added.')).toBeDefined()
    expect(screen.getByRole('button', { name: 'Retry' })).toBeDefined()
  })

  it('holds the address while Subscribe runs, and adds the Feed it shows', async () => {
    const created = Promise.withResolvers<Reply<CreateSubscriptionResponse>>()
    const api = stubApi()
      .on('POST /api/subscriptions/preview', { body: { kind: 'feed', feed: PREVIEWED } })
      .on('POST /api/subscriptions', () => created.promise)
    openFeeds()
    const user = userEvent.setup()

    await lookUp(user, PREVIEWED.feedUrl)
    await user.click(await screen.findByRole('button', { name: 'Subscribe to Field Notes' }))
    const field = await address()
    await user.type(field, 'other.example')

    expect(field.value).toBe(PREVIEWED.feedUrl)
    expect(screen.getByRole('button', { name: 'Subscribing' })).toBeDefined()
    created.resolve({ status: 201, body: { subscription: FEED } })
    await waitFor(() => expect(window.location.pathname).toBe('/feeds/1'))
    expect(api.requestsTo('POST /api/subscriptions')).toMatchObject([{ body: { url: PREVIEWED.feedUrl } }])
  })

  it('clears a refused Subscribe when it is tried again', async () => {
    const api = stubApi()
      .on('POST /api/subscriptions/preview', { body: { kind: 'feed', feed: PREVIEWED } })
      .on('POST /api/subscriptions', {
        status: 502,
        body: { error: { code: 'feed_unreachable', message: 'Feed could not be reached' } },
      })
    openFeeds()
    const user = userEvent.setup()

    await lookUp(user, PREVIEWED.feedUrl)
    await user.click(await screen.findByRole('button', { name: 'Subscribe to Field Notes' }))
    await screen.findByText('journal.example couldn’t be reached. Nothing was added.')
    api.on('POST /api/subscriptions', () => new Promise(() => {}))
    await user.click(await screen.findByRole('button', { name: 'Subscribe to Field Notes' }))

    expect(await screen.findByRole('button', { name: 'Subscribing' })).toBeDefined()
    expect(screen.queryByText('journal.example couldn’t be reached. Nothing was added.')).toBeNull()
  })
})

describe('the Feeds list', () => {
  it('groups Subscriptions by Rhythm, with each Feed’s site and Feed Items over 30 days', async () => {
    stubApi().on('GET /api/feeds', {
      body: {
        subscriptions: [
          { ...FEED, title: 'Busy', cadence: activeOn(20) },
          { ...FEED, feedId: 2, title: 'Quiet', domain: 'quiet.example', cadence: activeOn(0) },
        ],
      },
    })
    openFeeds()

    expect(await screen.findByText('2 Subscriptions')).toBeDefined()
    const daily = screen.getByRole('region', { name: 'Daily' })
    expect(within(daily).getByRole('link', { name: 'Busy' })).toBeDefined()
    expect(within(daily).getByText('20')).toBeDefined()
    const inactive = screen.getByRole('region', { name: 'Inactive' })
    expect(within(inactive).getByRole('link', { name: 'Quiet' })).toBeDefined()
    expect(within(inactive).getByText('quiet.example')).toBeDefined()
    expect(screen.queryByRole('region', { name: 'Weekly' })).toBeNull()
  })

  it('says so before there is any Subscription, and offers the address line at once', async () => {
    stubApi()
    openFeeds()

    expect(await screen.findByText('No Feeds yet.')).toBeDefined()
    await waitFor(async () => expect(document.activeElement).toBe(await address()))
  })
})

describe('Feed Availability', () => {
  it('says nothing about a Subscription whose checking works', async () => {
    stubApi().on('GET /api/feeds', { body: { subscriptions: [FEED] } })
    openFeeds()

    expect(await screen.findByRole('link', { name: 'Field Notes' })).toBeDefined()
    expect(screen.queryByRole('button', { name: /^Retry/ })).toBeNull()
    expect(screen.queryByText(/waiting for first check/i)).toBeNull()
  })

  it('notes a Subscription still waiting for its first check', async () => {
    stubApi().on('GET /api/feeds', { body: { subscriptions: [UNCHECKED_FEED] } })
    openFeeds()

    expect(await screen.findByText('Waiting for first check')).toBeDefined()
    expect(screen.queryByRole('button', { name: /^Retry/ })).toBeNull()
  })

  it('asks again while a Subscription waits for its first check, and stops once it is checked', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'], shouldAdvanceTime: true })
    const api = stubApi().on('GET /api/feeds', { body: { subscriptions: [UNCHECKED_FEED] } })
    openFeeds()
    expect(await screen.findByText('Waiting for first check')).toBeDefined()

    api.on('GET /api/feeds', { body: { subscriptions: [FEED] } })
    await act(() => vi.advanceTimersByTimeAsync(2_000))
    await waitFor(() => expect(screen.queryByText('Waiting for first check')).toBeNull())

    const asked = api.requestsTo('GET /api/feeds').length
    await act(() => vi.advanceTimersByTimeAsync(10_000))
    expect(api.requestsTo('GET /api/feeds')).toHaveLength(asked)
  })

  it('surfaces a calm note with the failure category, last success, and a retry action', async () => {
    stubApi().on('GET /api/feeds', { body: { subscriptions: [UNAVAILABLE_FEED] } })
    openFeeds()

    expect(await screen.findByText(/the publisher is answering with an error/i)).toBeDefined()
    expect(screen.getByText(/last reached/i)).toBeDefined()
    expect(screen.getByRole('button', { name: 'Retry Field Notes' })).toBeDefined()
  })

  it('names the year of a last success before the latest check’s year', async () => {
    const lastYear = subscription({
      availability: unavailable({ lastSuccessDate: day('2025-12-31') }),
    })
    stubApi().on('GET /api/feeds', { body: { subscriptions: [lastYear] } })
    openFeeds()

    expect(await screen.findByText(/Last reached 31 Dec 2025\./)).toBeDefined()
  })

  it('retries by hand and shows the restored Subscription at once', async () => {
    const api = stubApi().on('GET /api/feeds', { body: { subscriptions: [UNAVAILABLE_FEED] } })
    api.on('POST /api/feeds/1/refresh', () => {
      api.on('GET /api/feeds', { body: { subscriptions: [FEED] } })
      return { body: { observedItems: 2 } }
    })
    openFeeds()
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'Retry Field Notes' }))

    expect(await screen.findByText('The Feed answered. Checking works again.')).toBeDefined()
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Retry Field Notes' })).toBeNull())
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
    openFeeds()
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'Retry Field Notes' }))

    expect(await screen.findByText('Checked a moment ago. Wait a little before retrying.')).toBeDefined()
    expect(screen.getByRole('button', { name: 'Retry Field Notes' })).toBeDefined()
  })
})

describe('OPML import', () => {
  const OPML = '<opml version="2.0"><body><outline xmlUrl="https://journal.example/feed"/></body></opml>'

  it('imports an OPML file, reports what it recorded, and lists the new Feeds', async () => {
    const api = stubApi().on('POST /api/subscriptions/import', {
      body: { added: 2, alreadySubscribed: 1, unusable: ['not a url'] },
    })
    openFeeds()
    const user = userEvent.setup()

    api.on('GET /api/feeds', { body: { subscriptions: [FEED] } })
    await importFile(user, new File([OPML], 'subscriptions.opml', { type: 'text/x-opml' }))

    expect(await screen.findByText('Added 2 Feeds, 1 already followed, 1 not usable.')).toBeDefined()
    expect(api.requestsTo('POST /api/subscriptions/import')).toMatchObject([{ body: { opml: OPML } }])
    expect(await screen.findByRole('link', { name: 'Field Notes' })).toBeDefined()
  })

  it('explains an upload the server refused, even one the picker’s filter would have discouraged', async () => {
    stubApi().on('POST /api/subscriptions/import', {
      status: 422,
      body: { error: { code: 'unsupported_opml', message: 'The file is not an OPML subscription list' } },
    })
    openFeeds()
    const user = userEvent.setup({ applyAccept: false })

    await importFile(user, new File(['not xml'], 'notes.txt', { type: 'text/plain' }))

    expect(await screen.findByText('That file isn’t an OPML subscription list.')).toBeDefined()
  })
})
