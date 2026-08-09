import { render, screen } from '@testing-library/react'
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
})

const DIGEST = {
  today: { date: '2026-08-08', volume: 2 },
  groups: [
    { date: '2026-08-08', label: 'today', items: [item(3, 'First light', '07:15'), item(2, 'Second thoughts', '06:40')] },
    { date: '2026-08-07', label: 'yesterday', items: [item(1, 'Evening notes', '09:31')] },
    { date: '2026-06-03', label: 'june 3, 2026', items: [item(4, 'A June letter', '12:00')] },
  ],
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
    expect(screen.getByRole('button', { name: 'save First light' })).toHaveProperty('disabled', true)
    expect(container.textContent).not.toMatch(/unread|mark|archive/i)
  })

  it('says today · 1 post, in the singular, when one post is all there is', async () => {
    stubApi().on('GET /api/digest', {
      body: { today: { date: '2026-08-08', volume: 1 }, groups: [{ ...DIGEST.groups[0], items: [item(3, 'First light', '07:15')] }] },
    })
    window.history.replaceState(null, '', '/')
    render(<App />)

    expect(await screen.findByRole('heading', { name: 'today · 1 post' })).toBeDefined()
  })

  it('counts nothing on a day when nothing has landed yet', async () => {
    stubApi().on('GET /api/digest', {
      body: { today: { date: '2026-08-08', volume: 0 }, groups: [DIGEST.groups[1], DIGEST.groups[2]] },
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
