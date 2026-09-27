import { render, screen } from '@testing-library/react'
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
      displayDate: 'Today, 07:15',
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
      displayDate: '3 June',
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
    expect(screen.getByRole('heading', { level: 1, name: 'Saved' })).toBeDefined()
    expect(screen.getByText('Today, 07:15')).toBeDefined()
    expect(screen.getByText('3 June')).toBeDefined()

    for (const title of ['First light', 'A June letter']) {
      const toggle = screen.getByRole('button', { name: `Save ${title}` })
      expect(toggle.getAttribute('aria-pressed')).toBe('true')
      expect(toggle.getAttribute('aria-pressed')).toBe('true')
    }

    expect(container.querySelector('main')?.textContent).not.toMatch(/unread|mark|archive|\d+ (posts|items)/i)
  })

  it('leaves an undo line where an unsaved item was, and undoes through the Library', async () => {
    const api = stubApi()
      .on('GET /api/library', { body: LIBRARY })
      .on('DELETE /api/library/3', { body: { feedItemId: 3, saved: false, savedAt: null } })
      .on('PUT /api/library/3', { body: { feedItemId: 3, saved: true, savedAt: '2026-08-08T09:06:00.000Z' } })
    window.history.replaceState(null, '', '/saved')
    render(<App />)
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'Save First light' }))

    expect(await screen.findByText('“First light” is no longer saved.')).toBeDefined()
    expect(screen.queryByRole('heading', { name: 'First light' })).toBeNull()
    expect(screen.getByRole('heading', { name: 'A June letter' })).toBeDefined()
    expect(api.requestsTo('DELETE /api/library/3')).toHaveLength(1)

    await user.click(screen.getByRole('button', { name: 'Undo' }))

    const toggle = await screen.findByRole('button', { name: 'Save First light' })
    expect(toggle.getAttribute('aria-pressed')).toBe('true')
    expect(api.requestsTo('PUT /api/library/3')).toHaveLength(1)
  })

  it('keeps the undo line when saving again fails', async () => {
    stubApi()
      .on('GET /api/library', { body: LIBRARY })
      .on('DELETE /api/library/3', { body: { feedItemId: 3, saved: false, savedAt: null } })
      .on('PUT /api/library/3', { status: 503, body: { error: { code: 'unavailable', message: 'Unavailable' } } })
    window.history.replaceState(null, '', '/saved')
    render(<App />)
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'Save First light' }))
    await user.click(await screen.findByRole('button', { name: 'Undo' }))

    expect(await screen.findByText('“First light” couldn’t be saved again. Try once more.')).toBeDefined()
    expect(screen.getByRole('button', { name: 'Undo' })).toBeDefined()
  })

  it('says quietly when a save outlived its Subscription, keeping the attribution', async () => {
    const items = [LIBRARY.items[0], { ...LIBRARY.items[1], subscribed: false }]
    stubApi().on('GET /api/library', { body: { items, nextCursor: null } })
    window.history.replaceState(null, '', '/saved')
    const { container } = render(<App />)

    expect(await screen.findByText('3 June · No longer subscribed')).toBeDefined()
    expect(screen.getByText('The Slow Press').tagName).toBe('SPAN')
    expect(screen.getByText('Field Notes').textContent).toBe('Field Notes')
    expect(container.querySelector('main')?.textContent).not.toMatch(/remove|delete|clean/i)
  })

  it('explains an empty Library with direction, not mechanics', async () => {
    stubApi()
    window.history.replaceState(null, '', '/saved')
    render(<App />)

    expect(
      await screen.findByText('Nothing saved yet. Save an item from the digest or a feed to keep it here.'),
    ).toBeDefined()
  })

  it('tells a silent network apart from a refusing server, and offers the way back', async () => {
    const api = stubApi().on('GET /api/library', () => {
      throw new TypeError('fetch failed')
    })
    window.history.replaceState(null, '', '/saved')
    render(<App />)
    const user = userEvent.setup()

    expect(await screen.findByText('Your saves can’t be reached. Check the connection, then try again.')).toBeDefined()

    api.on('GET /api/library', { body: LIBRARY })
    await user.click(screen.getByRole('button', { name: 'Retry' }))

    expect(await screen.findByRole('heading', { name: 'First light' })).toBeDefined()
  })

  it('blames the reader, not the connection, when the answer fails its schema', async () => {
    stubApi().on('GET /api/library', { body: { unexpected: true } })
    window.history.replaceState(null, '', '/saved')
    render(<App />)

    expect(await screen.findByText('Your saves didn’t load. Try again in a moment.')).toBeDefined()
  })
})
