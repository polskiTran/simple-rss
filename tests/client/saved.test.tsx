import { act, render, screen, waitFor, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App } from '../../src/client/app.js'
import type { Library } from '../../src/shared/api.js'
import { library, libraryItem } from './fixtures.js'
import { stubApi } from './stub-api.js'

const LIBRARY = library()

function openLibrary() {
  window.history.replaceState(null, '', '/saved')
  return render(<App />)
}

function titles() {
  return within(screen.getByRole('main'))
    .getAllByRole('link')
    .map((link) => link.textContent)
    .filter((text) => text === 'First light' || text === 'A June letter' || text === 'A newer save')
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('the Library', () => {
  it('lists each save with its title, Feed and the day it was saved, each saved', async () => {
    stubApi().on('GET /api/library', { body: LIBRARY })
    const { container } = openLibrary()

    expect(await screen.findByRole('link', { name: 'First light' })).toBeDefined()
    expect(screen.getByRole('link', { name: 'A June letter' })).toBeDefined()
    expect(screen.getByRole('link', { name: 'Field Notes' })).toBeDefined()
    expect(screen.getByRole('link', { name: 'The Slow Press' })).toBeDefined()
    expect(screen.getByText('2 saved Feed Items')).toBeDefined()
    expect(screen.getByText('Today')).toBeDefined()

    for (const title of ['First light', 'A June letter']) {
      expect(screen.getByRole('button', { name: `Saved ${title}` }).getAttribute('aria-pressed')).toBe('true')
    }
    expect(container.querySelector('main')?.textContent).not.toMatch(/unread|archive/i)
  })

  it('keeps an unsaved row in place with Save, which saves it again through the Library', async () => {
    const api = stubApi()
      .on('GET /api/library', { body: LIBRARY })
      .on('DELETE /api/library/3', { body: { feedItemId: 3, saved: false, savedAt: null } })
      .on('PUT /api/library/3', { body: { feedItemId: 3, saved: true, savedAt: '2026-08-08T09:06:00.000Z' } })
    openLibrary()
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'Saved First light' }))

    expect(await screen.findByRole('button', { name: 'Save First light' })).toBeDefined()
    expect(screen.getByText('1 saved Feed Item')).toBeDefined()
    expect(screen.getByRole('link', { name: 'First light' })).toBeDefined()
    expect(api.requestsTo('DELETE /api/library/3')).toHaveLength(1)

    await user.click(screen.getByRole('button', { name: 'Save First light' }))

    expect(await screen.findByRole('button', { name: 'Saved First light' })).toBeDefined()
    expect(api.requestsTo('PUT /api/library/3')).toHaveLength(1)
  })

  it('says so when saving again fails, and keeps Save on offer', async () => {
    stubApi()
      .on('GET /api/library', { body: LIBRARY })
      .on('DELETE /api/library/3', { body: { feedItemId: 3, saved: false, savedAt: null } })
      .on('PUT /api/library/3', { status: 503, body: { error: { code: 'unavailable', message: 'Unavailable' } } })
    openLibrary()
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'Saved First light' }))
    await user.click(await screen.findByRole('button', { name: 'Save First light' }))

    expect(await screen.findByText('“First light” couldn’t be saved. Try once more.')).toBeDefined()
    expect(screen.getByRole('button', { name: 'Save First light' })).toBeDefined()
  })

  it('keeps the name of a Feed a save outlived, with nowhere to go', async () => {
    const items = LIBRARY.items.map((item) => (item.feedItemId === 1 ? { ...item, subscribed: false } : item))
    stubApi().on('GET /api/library', { body: { ...LIBRARY, items } })
    openLibrary()

    const gone = await screen.findByText('The Slow Press')
    expect(gone.tagName).toBe('SPAN')
    expect(gone.getAttribute('title')).toBe('No longer subscribed')
    expect(screen.getByRole('link', { name: 'Field Notes' })).toBeDefined()
  })

  it('groups saves by the month they were saved', async () => {
    stubApi().on('GET /api/library', { body: LIBRARY })
    openLibrary()

    expect(await screen.findByRole('heading', { level: 2, name: 'August' })).toBeDefined()
    expect(screen.getByRole('heading', { level: 2, name: 'July' })).toBeDefined()
  })

  it('turns the Library around by asking for the oldest saves, and pages on', async () => {
    const api = stubApi()
      .on('GET /api/library', { body: LIBRARY })
      .on('GET /api/library?order=oldest', {
        body: { ...LIBRARY, items: LIBRARY.items.toReversed(), nextCursor: 'next' },
      })
      .on('GET /api/library?order=oldest&cursor=next', { body: { ...LIBRARY, items: [], nextCursor: null } })
    openLibrary()
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'Oldest saved' }))

    await waitFor(() => expect(titles()).toEqual(['A June letter', 'First light']))
    await user.click(screen.getByRole('button', { name: 'Show older saves' }))
    expect(api.requestsTo('GET /api/library?order=oldest&cursor=next')).toHaveLength(1)
  })

  it('drops a page of the old order that answers after the order changed', async () => {
    const stalePage = Promise.withResolvers<{ body: Library }>()
    stubApi()
      .on('GET /api/library', { body: { ...LIBRARY, nextCursor: 'next' } })
      .on('GET /api/library?cursor=next', () => stalePage.promise)
      .on('GET /api/library?order=oldest', { body: { ...LIBRARY, items: LIBRARY.items.toReversed() } })
    openLibrary()
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'Show older saves' }))
    await user.click(screen.getByRole('button', { name: 'Oldest saved' }))
    await waitFor(() => expect(titles()).toEqual(['A June letter', 'First light']))

    stalePage.resolve({ body: library({ items: [libraryItem({ feedItemId: 9, title: 'A newer save' })] }) })
    await act(() => stalePage.promise)

    expect(screen.queryByRole('link', { name: 'A newer save' })).toBeNull()
    expect(titles()).toHaveLength(2)
  })

  it('groups the saves by Feed without asking again', async () => {
    const api = stubApi().on('GET /api/library', { body: LIBRARY })
    openLibrary()
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'By Feed' }))

    expect(screen.getByRole('heading', { level: 2, name: 'Field Notes' })).toBeDefined()
    expect(screen.getByRole('heading', { level: 2, name: 'The Slow Press' })).toBeDefined()
    expect(api.requestsTo('GET /api/library')).toHaveLength(1)
  })

  it('explains an empty Library with where saves come from', async () => {
    stubApi()
    openLibrary()

    expect(
      await screen.findByText('Nothing saved yet. Save a Feed Item from the Digest, a Feed or the Reader View.'),
    ).toBeDefined()
  })

  it('tells a silent network apart from a refusing server, and offers the way back', async () => {
    const api = stubApi().on('GET /api/library', () => {
      throw new TypeError('fetch failed')
    })
    openLibrary()
    const user = userEvent.setup()

    expect(await screen.findByText(/The Library can’t be reached\./)).toBeDefined()

    api.on('GET /api/library', { body: LIBRARY })
    await user.click(screen.getByRole('button', { name: 'Retry' }))

    expect(await screen.findByRole('link', { name: 'First light' })).toBeDefined()
  })

  it('blames the reader, not the connection, when the answer fails its schema', async () => {
    stubApi().malformed('GET /api/library')
    openLibrary()

    expect(await screen.findByText(/The Library didn’t load\./)).toBeDefined()
  })
})
