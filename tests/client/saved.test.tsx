import { render, screen } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App } from '../../src/client/app.js'
import { library } from './fixtures.js'
import { stubApi } from './stub-api.js'

const LIBRARY = library()

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('the Saved tab', () => {
  it('lists the Library in the shared shape: title, source, when it was saved, saved', async () => {
    stubApi().on('GET /api/library', { body: LIBRARY })
    window.history.replaceState(null, '', '/saved')
    const { container } = render(<App />)

    expect(await screen.findByRole('heading', { name: 'First light' })).toBeDefined()
    expect(screen.getByRole('heading', { name: 'A June letter' })).toBeDefined()
    expect(screen.getByText('Field Notes')).toBeDefined()
    expect(screen.getByText('The Slow Press')).toBeDefined()
    expect(screen.getByRole('heading', { level: 1, name: 'Saved 2' })).toBeDefined()
    expect(screen.getByText('Saved today')).toBeDefined()
    expect(screen.getByText('Saved 28 July')).toBeDefined()

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
    const items = LIBRARY.items.map((item) => (item.feedItemId === 1 ? { ...item, subscribed: false } : item))
    stubApi().on('GET /api/library', { body: { ...LIBRARY, items } })
    window.history.replaceState(null, '', '/saved')
    const { container } = render(<App />)

    expect(await screen.findByText('Saved 28 July · No longer subscribed')).toBeDefined()
    expect(screen.getByText('The Slow Press').tagName).toBe('SPAN')
    expect(screen.getByText('Field Notes').textContent).toBe('Field Notes')
    expect(container.querySelector('main')?.textContent).not.toMatch(/remove|delete|clean/i)
  })

  it('groups saves by the month they were saved, counting a month only once it is whole', async () => {
    stubApi().on('GET /api/library', { body: { ...LIBRARY, total: 3, nextCursor: 'more' } })
    window.history.replaceState(null, '', '/saved')
    render(<App />)

    // August has given way to July, so August is whole; July may go on past this page.
    expect(await screen.findByRole('heading', { level: 2, name: 'August 1' })).toBeDefined()
    expect(screen.getByRole('heading', { level: 2, name: 'July' })).toBeDefined()
  })

  it('turns the Library around by asking for the oldest saves, and pages toward newer ones', async () => {
    const api = stubApi()
      .on('GET /api/library', { body: LIBRARY })
      .on('GET /api/library?order=oldest', {
        body: { ...LIBRARY, items: LIBRARY.items.toReversed(), nextCursor: 'next' },
      })
      .on('GET /api/library?order=oldest&cursor=next', { body: { ...LIBRARY, items: [], nextCursor: null } })
    window.history.replaceState(null, '', '/saved')
    render(<App />)
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'Oldest saved' }))

    const headings = await screen.findAllByRole('heading', { level: 3 })
    expect(headings.map((heading) => heading.textContent)).toEqual(['A June letter', 'First light'])
    await user.click(screen.getByRole('button', { name: 'Show more' }))
    expect(api.requestsTo('GET /api/library?order=oldest&cursor=next')).toHaveLength(1)
  })

  it('groups the saves by Feed without asking again, counting a Feed only once the list has ended', async () => {
    const api = stubApi().on('GET /api/library', { body: LIBRARY })
    window.history.replaceState(null, '', '/saved')
    render(<App />)
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'By feed' }))

    expect(screen.getByRole('heading', { level: 2, name: 'Field Notes 1' })).toBeDefined()
    expect(screen.getByRole('heading', { level: 2, name: 'The Slow Press 1' })).toBeDefined()
    expect(api.requestsTo('GET /api/library')).toHaveLength(1)
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
    stubApi().malformed('GET /api/library')
    window.history.replaceState(null, '', '/saved')
    render(<App />)

    expect(await screen.findByText('Your saves didn’t load. Try again in a moment.')).toBeDefined()
  })
})
