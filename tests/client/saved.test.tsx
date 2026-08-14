import { render, screen, waitFor } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App } from '../../src/client/app.js'
import { stubApi } from './stub-api.js'

const LIBRARY = {
  items: [
    {
      feedItemId: 3,
      title: 'First light',
      feedId: 1,
      feedTitle: 'Field Notes',
      subscribed: true,
      link: 'https://journal.example/first-light',
      publishedAt: '2026-08-08T07:15:00.000Z',
      firstSeenAt: '2026-08-08T09:00:00.000Z',
      savedAt: '2026-08-08T09:05:00.000Z',
      displayDate: 'today, 07:15',
    },
    {
      feedItemId: 1,
      title: 'A June letter',
      feedId: 2,
      feedTitle: 'The Slow Press',
      subscribed: true,
      link: null,
      publishedAt: '2026-06-03T12:00:00.000Z',
      firstSeenAt: '2026-06-03T13:00:00.000Z',
      savedAt: '2026-08-01T08:00:00.000Z',
      displayDate: '3 june',
    },
  ],
  nextCursor: null,
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('the Saved tab', () => {
  it('lists the Library in the shared shape: title, source, date, saved', async () => {
    stubApi().on('GET /api/library', { body: LIBRARY })
    window.history.replaceState(null, '', '/saved')
    const { container } = render(<App />)

    expect(await screen.findByRole('heading', { name: 'First light' })).toBeDefined()
    expect(screen.getByRole('heading', { name: 'A June letter' })).toBeDefined()
    expect(screen.getByText('Field Notes')).toBeDefined()
    expect(screen.getByText('The Slow Press')).toBeDefined()
    expect(screen.getByText('today, 07:15')).toBeDefined()
    expect(screen.getByText('3 june')).toBeDefined()

    for (const title of ['First light', 'A June letter']) {
      const toggle = screen.getByRole('button', { name: `save ${title}` })
      expect(toggle.textContent).toBe('saved')
      expect(toggle.getAttribute('aria-pressed')).toBe('true')
    }

    expect(container.querySelector('main')?.textContent).not.toMatch(/unread|mark|archive|\d+ (posts|items)/i)
  })

  it('unsaves in place and keeps the row, so a misread tap can be undone', async () => {
    const api = stubApi()
      .on('GET /api/library', { body: LIBRARY })
      .on('DELETE /api/library/3', { body: { feedItemId: 3, saved: false, savedAt: null } })
      .on('PUT /api/library/3', { body: { feedItemId: 3, saved: true, savedAt: '2026-08-08T09:06:00.000Z' } })
    window.history.replaceState(null, '', '/saved')
    render(<App />)
    const user = userEvent.setup()

    const toggle = await screen.findByRole('button', { name: 'save First light' })
    await user.click(toggle)

    await waitFor(() => expect(toggle.textContent).toBe('save'))
    expect(api.requestsTo('DELETE /api/library/3')).toHaveLength(1)
    expect(screen.getByRole('heading', { name: 'First light' })).toBeDefined()

    await user.click(toggle)

    await waitFor(() => expect(toggle.textContent).toBe('saved'))
    expect(api.requestsTo('PUT /api/library/3')).toHaveLength(1)
  })

  it('says quietly when a save outlived its Subscription, keeping the attribution', async () => {
    const items = [LIBRARY.items[0], { ...LIBRARY.items[1], subscribed: false }]
    stubApi().on('GET /api/library', { body: { items, nextCursor: null } })
    window.history.replaceState(null, '', '/saved')
    const { container } = render(<App />)

    expect(await screen.findByText('The Slow Press · no longer subscribed')).toBeDefined()
    expect(screen.getByText('Field Notes').textContent).toBe('Field Notes')
    expect(container.querySelector('main')?.textContent).not.toMatch(/remove|delete|clean/i)
  })

  it('explains an empty Library with direction, not mechanics', async () => {
    stubApi()
    window.history.replaceState(null, '', '/saved')
    render(<App />)

    expect(
      await screen.findByText('nothing saved yet — save an item from the digest or a feed to keep it here'),
    ).toBeDefined()
  })

  it('tells a silent network apart from a refusing server, and offers the way back', async () => {
    const api = stubApi().on('GET /api/library', () => {
      throw new TypeError('fetch failed')
    })
    window.history.replaceState(null, '', '/saved')
    render(<App />)
    const user = userEvent.setup()

    expect(
      await screen.findByText('the library is out of reach — check the connection, then try again'),
    ).toBeDefined()

    api.on('GET /api/library', { body: LIBRARY })
    await user.click(screen.getByRole('button', { name: 'try again' }))

    expect(await screen.findByRole('heading', { name: 'First light' })).toBeDefined()
  })

  it('blames the reader, not the connection, when the answer fails its schema', async () => {
    stubApi().on('GET /api/library', { body: { unexpected: true } })
    window.history.replaceState(null, '', '/saved')
    render(<App />)

    expect(await screen.findByText('the library is unavailable — try again in a moment')).toBeDefined()
  })
})
