import { render, screen, waitFor } from '@testing-library/react'
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
    { date: '2026-08-08', label: 'today', items: [item(3, 'First light', '07:15'), item(2, 'Second thoughts', '06:40')] },
    { date: '2026-08-07', label: 'yesterday', items: [item(1, 'Evening notes', '09:31')] },
    { date: '2026-06-03', label: 'june 3, 2026', items: [item(4, 'A June letter', '12:00')] },
  ],
  nextCursor: null,
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('the chronological Digest', () => {
  it('renders the band, the counted today heading, and the quiet past headings', async () => {
    stubApi().on('GET /api/digest', { body: DIGEST })
    window.history.replaceState(null, '', '/')
    const { container } = render(<App />)

    // Today's heading carries the one number the design allows: how much
    // there is to read today. Past days carry none.
    expect(await screen.findByRole('heading', { name: 'today · 2 posts' })).toBeDefined()
    const yesterday = screen.getByRole('heading', { name: 'yesterday' })
    expect(yesterday.className).toContain('day-heading-past')
    expect(yesterday.textContent).toBe('yesterday')
    expect(screen.getByRole('heading', { name: 'june 3, 2026' }).className).toContain('day-heading-past')

    // The band is one element whose long shadow list is the field itself.
    const field = container.querySelector<HTMLElement>('.daily-band-field')
    expect(field?.style.boxShadow).toContain('var(--band-')

    // Meta is source · time · save — and nothing resembling inbox state.
    const save = screen.getByRole('button', { name: 'save First light' })
    expect(save.textContent).toBe('save')
    expect(save.getAttribute('aria-pressed')).toBe('false')
    expect(container.textContent).not.toMatch(/unread|mark|archive/i)
  })

  it('flips save to saved in place once the server confirms, and back', async () => {
    const api = stubApi()
      .on('GET /api/digest', { body: DIGEST })
      .on('PUT /api/library/3', { body: { feedItemId: 3, saved: true, savedAt: '2026-08-08T09:05:00.000Z' } })
      .on('DELETE /api/library/3', { body: { feedItemId: 3, saved: false, savedAt: null } })
    window.history.replaceState(null, '', '/')
    render(<App />)
    const user = userEvent.setup()

    const toggle = await screen.findByRole('button', { name: 'save First light' })
    await user.click(toggle)

    await waitFor(() => expect(toggle.textContent).toBe('saved'))
    expect(toggle.getAttribute('aria-pressed')).toBe('true')
    expect(api.requestsTo('PUT /api/library/3')).toHaveLength(1)

    await user.click(toggle)

    await waitFor(() => expect(toggle.textContent).toBe('save'))
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

    const toggle = await screen.findByRole('button', { name: 'save First light' })
    await user.click(toggle)

    // The word reports only what the server has confirmed.
    await waitFor(() => expect(toggle.textContent).toBe('save'))
    expect(toggle.getAttribute('aria-pressed')).toBe('false')
  })

  it('says today · 1 post, in the singular, when one post is all there is', async () => {
    stubApi().on('GET /api/digest', {
      body: { today: { date: '2026-08-08', volume: 1 }, groups: [{ ...DIGEST.groups[0], items: [item(3, 'First light', '07:15')] }], nextCursor: null },
    })
    window.history.replaceState(null, '', '/')
    render(<App />)

    expect(await screen.findByRole('heading', { name: 'today · 1 post' })).toBeDefined()
  })

  it('counts nothing on a day when nothing has landed yet', async () => {
    stubApi().on('GET /api/digest', {
      body: { today: { date: '2026-08-08', volume: 0 }, groups: [DIGEST.groups[1], DIGEST.groups[2]], nextCursor: null },
    })
    window.history.replaceState(null, '', '/')
    render(<App />)

    // No items landed today, so no today group and no count anywhere.
    expect(await screen.findByRole('heading', { name: 'yesterday' })).toBeDefined()
    expect(screen.queryByText(/\d+ posts?/)).toBeNull()
  })

  it('offers direction rather than mechanics when there is nothing yet', async () => {
    stubApi()
    window.history.replaceState(null, '', '/')
    render(<App />)

    expect(await screen.findByText('nothing yet — subscribe to a Feed to start your digest')).toBeDefined()
  })

  it('tells a silent network apart from a refusing server, and offers the way back', async () => {
    const api = stubApi().on('GET /api/digest', () => {
      throw new TypeError('fetch failed')
    })
    window.history.replaceState(null, '', '/')
    render(<App />)
    const user = userEvent.setup()

    expect(
      await screen.findByText('the digest is out of reach — check the connection, then try again'),
    ).toBeDefined()

    // The connection comes back; trying again is enough.
    api.on('GET /api/digest', { body: DIGEST })
    await user.click(screen.getByRole('button', { name: 'try again' }))

    expect(await screen.findByRole('heading', { name: 'today · 2 posts' })).toBeDefined()
  })

  it('blames the reader, not the connection, when the answer fails its schema', async () => {
    stubApi().on('GET /api/digest', { body: { unexpected: true } })
    window.history.replaceState(null, '', '/')
    render(<App />)

    expect(await screen.findByText('the digest is unavailable — try again in a moment')).toBeDefined()
  })

  it('names a server failure without dressing it up', async () => {
    stubApi().on('GET /api/digest', {
      status: 503,
      body: { error: { code: 'unavailable', message: 'Service unavailable' } },
    })
    window.history.replaceState(null, '', '/')
    render(<App />)

    expect(await screen.findByText('the digest is unavailable — try again in a moment')).toBeDefined()
    expect(screen.getByRole('button', { name: 'try again' })).toBeDefined()
  })
})

const result = (feedItemId: number, title: string, displayDate: string, saved = false) => ({
  feedItemId,
  title,
  feedId: 1,
  feedTitle: 'Field Notes',
  publishedAt: '2026-08-08T07:15:00.000Z',
  firstSeenAt: '2026-08-08T09:00:00.000Z',
  displayDate,
  saved,
})

describe('searching from the Digest', () => {
  it('swaps the Digest for results that say title, Feed, date, and saved state', async () => {
    stubApi()
      .on('GET /api/digest', { body: DIGEST })
      .on('GET /api/search?q=chronology', {
        body: { results: [result(9, 'Morning chronology', 'today, 07:15'), result(8, 'Tide chronology', '3 june', true)] },
      })
    window.history.replaceState(null, '', '/')
    render(<App />)
    const user = userEvent.setup()

    const field = await screen.findByRole('searchbox', { name: 'search your reading' })
    await user.type(field, 'chronology')

    const results = await screen.findByRole('region', { name: 'search results' })
    expect(results.textContent).toContain('Morning chronology')
    expect(results.textContent).toContain('Field Notes')
    expect(results.textContent).toContain('today, 07:15')
    expect(screen.getByRole('button', { name: 'save Tide chronology' }).textContent).toBe('saved')
    // The Digest itself is not rendered while results are shown.
    expect(screen.queryByRole('heading', { name: 'today · 2 posts' })).toBeNull()

    // Clearing the line brings the Digest straight back, no refetch needed.
    await user.clear(field)
    expect(await screen.findByRole('heading', { name: 'today · 2 posts' })).toBeDefined()
    expect(screen.queryByRole('region', { name: 'search results' })).toBeNull()
  })

  it('says while it is searching, and that nothing matched when nothing did', async () => {
    stubApi()
      .on('GET /api/digest', { body: DIGEST })
      .on('GET /api/search?q=driftwood', { body: { results: [] } })
    window.history.replaceState(null, '', '/')
    render(<App />)
    const user = userEvent.setup()

    await user.type(await screen.findByRole('searchbox', { name: 'search your reading' }), 'driftwood')

    // The pending state is announced while the answer is out.
    expect((await screen.findByRole('status')).textContent).toBe('searching…')
    expect((await screen.findByText('nothing in your reading matches “driftwood”')).getAttribute('role')).toBe(
      'status',
    )
  })

  it('tells a silent network apart from a refusing server for a search too', async () => {
    const api = stubApi()
      .on('GET /api/digest', { body: DIGEST })
      .on('GET /api/search?q=drift', () => {
        throw new TypeError('fetch failed')
      })
    window.history.replaceState(null, '', '/')
    render(<App />)
    const user = userEvent.setup()

    const field = await screen.findByRole('searchbox', { name: 'search your reading' })
    await user.type(field, 'drift')
    expect(await screen.findByText('search is out of reach — check the connection, then try again')).toBeDefined()

    api.on('GET /api/search?q=driftless', {
      status: 503,
      body: { error: { code: 'unavailable', message: 'Unavailable' } },
    })
    await user.type(field, 'less')
    expect(await screen.findByText('search is unavailable — try again in a moment')).toBeDefined()
  })

  it('keeps a save made in the results when the User returns to the Digest', async () => {
    stubApi()
      .on('GET /api/digest', { body: DIGEST })
      .on('GET /api/search?q=first', { body: { results: [result(3, 'First light', 'today, 07:15')] } })
      .on('PUT /api/library/3', { body: { feedItemId: 3, saved: true, savedAt: '2026-08-08T09:05:00.000Z' } })
    window.history.replaceState(null, '', '/')
    render(<App />)
    const user = userEvent.setup()

    const field = await screen.findByRole('searchbox', { name: 'search your reading' })
    await user.type(field, 'first')
    const toggle = await screen.findByRole('button', { name: 'save First light' })
    await user.click(toggle)
    await waitFor(() => expect(toggle.textContent).toBe('saved'))

    // Back in the Digest, the same item already says so.
    await user.clear(field)
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'save First light' }).getAttribute('aria-pressed')).toBe('true'),
    )
  })
})
