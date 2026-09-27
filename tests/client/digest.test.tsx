import { render, screen, waitFor, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App } from '../../src/client/app.js'
import { stubApi } from './stub-api.js'

const item = (feedItemId: number, title: string, displayTime: string) => ({
  feedItemId,
  title,
  feedId: 1,
  feedTitle: 'Field Notes',
  link: `https://journal.example/${feedItemId}`,
  publishedAt: '2026-08-08T07:15:00.000Z',
  displayTime,
  imageUrl: null,
  summary: null,
  firstSeenAt: '2026-08-08T09:00:00.000Z',
  saved: false,
})

const DIGEST = {
  today: { date: '2026-08-08', volume: 2 },
  groups: [
    {
      date: '2026-08-08',
      label: 'Today',
      items: [item(3, 'First light', '07:15'), item(2, 'Second thoughts', '06:40')],
    },
    { date: '2026-08-07', label: 'Yesterday', items: [item(1, 'Evening notes', '09:31')] },
    { date: '2026-06-03', label: 'Wednesday 3 June', items: [item(4, 'A June letter', '12:00')] },
  ],
  nextCursor: null,
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('the chronological Digest', () => {
  it('titles the page with today and heads each day with its count', async () => {
    stubApi().on('GET /api/digest', { body: DIGEST })
    window.history.replaceState(null, '', '/')
    const { container } = render(<App />)

    expect(await screen.findByRole('heading', { level: 1, name: 'Digest Sat 8 Aug' })).toBeDefined()
    expect(screen.getByRole('heading', { name: 'Today 2' })).toBeDefined()
    expect(screen.getByRole('heading', { name: 'Yesterday 1' })).toBeDefined()
    expect(screen.getByRole('heading', { name: 'Wednesday 3 June 1' })).toBeDefined()
    expect(screen.getByText('Saturday 8 August')).toBeDefined()
    expect(screen.getByText('Friday 7 August')).toBeDefined()

    const [first] = screen.getAllByRole('article')
    expect(
      within(first as HTMLElement)
        .getByRole('link', { name: 'Field Notes' })
        .getAttribute('href'),
    ).toBe('/feeds/1')
    expect(within(first as HTMLElement).getByText('07:15')).toBeDefined()
    expect(screen.getByRole('button', { name: 'Save First light' }).getAttribute('aria-pressed')).toBe('false')
    expect(container.textContent).not.toMatch(/unread|mark|archive/i)
  })

  it('withholds the count of a day the next page may continue', async () => {
    stubApi().on('GET /api/digest', { body: { ...DIGEST, nextCursor: 'more' } })
    window.history.replaceState(null, '', '/')
    render(<App />)

    expect(await screen.findByRole('heading', { name: 'Yesterday 1' })).toBeDefined()
    expect(screen.getByRole('heading', { name: 'Wednesday 3 June' })).toBeDefined()
    expect(screen.getByRole('button', { name: 'Show older items' })).toBeDefined()
  })

  it('flips save to saved in place once the server confirms, and back', async () => {
    const api = stubApi()
      .on('GET /api/digest', { body: DIGEST })
      .on('PUT /api/library/3', { body: { feedItemId: 3, saved: true, savedAt: '2026-08-08T09:05:00.000Z' } })
      .on('DELETE /api/library/3', { body: { feedItemId: 3, saved: false, savedAt: null } })
    window.history.replaceState(null, '', '/')
    render(<App />)
    const user = userEvent.setup()

    const toggle = await screen.findByRole('button', { name: 'Save First light' })
    await user.click(toggle)

    await waitFor(() => expect(toggle.getAttribute('aria-pressed')).toBe('true'))
    expect(toggle.getAttribute('aria-pressed')).toBe('true')
    expect(api.requestsTo('PUT /api/library/3')).toHaveLength(1)

    await user.click(toggle)

    await waitFor(() => expect(toggle.getAttribute('aria-pressed')).toBe('false'))
    expect(toggle.getAttribute('aria-pressed')).toBe('false')
    expect(api.requestsTo('DELETE /api/library/3')).toHaveLength(1)
  })

  it('keeps saying save when the server refuses the save', async () => {
    stubApi()
      .on('GET /api/digest', { body: DIGEST })
      .on('PUT /api/library/3', { status: 503, body: { error: { code: 'unavailable', message: 'Unavailable' } } })
    window.history.replaceState(null, '', '/')
    render(<App />)
    const user = userEvent.setup()

    const toggle = await screen.findByRole('button', { name: 'Save First light' })
    await user.click(toggle)

    await waitFor(() => expect(toggle.getAttribute('aria-pressed')).toBe('false'))
    expect(toggle.getAttribute('aria-pressed')).toBe('false')
  })

  it('counts today from the server even when nothing has landed yet', async () => {
    stubApi().on('GET /api/digest', {
      body: {
        today: { date: '2026-08-08', volume: 0 },
        groups: [DIGEST.groups[1], DIGEST.groups[2]],
        nextCursor: null,
      },
    })
    window.history.replaceState(null, '', '/')
    render(<App />)

    expect(await screen.findByRole('heading', { name: 'Yesterday 1' })).toBeDefined()
    expect(screen.queryByRole('heading', { name: /^Today/ })).toBeNull()
  })

  it('offers direction rather than mechanics when there is nothing yet', async () => {
    stubApi()
    window.history.replaceState(null, '', '/')
    render(<App />)

    expect(await screen.findByText('Nothing yet. Subscribe to a feed in Feeds to start your digest.')).toBeDefined()
  })

  it('tells a silent network apart from a refusing server, and offers the way back', async () => {
    const api = stubApi().on('GET /api/digest', () => {
      throw new TypeError('fetch failed')
    })
    window.history.replaceState(null, '', '/')
    render(<App />)
    const user = userEvent.setup()

    expect(await screen.findByText('The digest can’t be reached. Check the connection, then try again.')).toBeDefined()

    api.on('GET /api/digest', { body: DIGEST })
    await user.click(screen.getByRole('button', { name: 'Retry' }))

    expect(await screen.findByRole('heading', { name: 'Today 2' })).toBeDefined()
  })

  it('blames the reader, not the connection, when the answer fails its schema', async () => {
    stubApi().on('GET /api/digest', { body: { unexpected: true } })
    window.history.replaceState(null, '', '/')
    render(<App />)

    expect(await screen.findByText('The digest didn’t load. Try again in a moment.')).toBeDefined()
  })

  it('names a server failure without dressing it up', async () => {
    stubApi().on('GET /api/digest', {
      status: 503,
      body: { error: { code: 'unavailable', message: 'Service unavailable' } },
    })
    window.history.replaceState(null, '', '/')
    render(<App />)

    expect(await screen.findByText('The digest didn’t load. Try again in a moment.')).toBeDefined()
    expect(screen.getByRole('button', { name: 'Retry' })).toBeDefined()
  })
})
