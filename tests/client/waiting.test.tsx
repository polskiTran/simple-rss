import { render, screen } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App } from '../../src/client/app.js'
import { stubApi, type Reply, type StubbedApi } from './stub-api.js'

/**
 * Every wait in the reader says the same two things: the words for what is
 * being waited on, and the mark's own tile beside them, glinting. These tests
 * hold the second one — the part a reader of the code cannot see is missing.
 */

/** A route that never answers, so the wait it belongs to stands still. */
const hangs = (): Promise<Reply> => new Promise(() => {})

/** Signed in, with every read left hanging. */
function waiting(): StubbedApi {
  return stubApi()
    .on('GET /api/digest', hangs)
    .on('GET /api/library', hangs)
    .on('GET /api/feeds', hangs)
    .on('GET /api/feeds/1', hangs)
    .on('GET /api/items/3', hangs)
}

function renderAt(path: string) {
  window.history.replaceState(null, '', path)
  return render(<App />)
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('a wait', () => {
  it.each([
    ['/digest', 'loading the digest'],
    ['/saved', 'loading the library'],
    ['/feeds', 'loading feeds'],
    ['/feeds/1', 'loading the feed'],
    ['/reader/3', 'opening the article'],
  ])('puts the mark beside the words at %s', async (path, words) => {
    waiting()
    renderAt(path)

    const note = await screen.findByText(words)

    expect(note.className).toContain('loading-note')
    expect(note.querySelector('.wordmark-grid')?.querySelectorAll('.wordmark-cell')).toHaveLength(16)
  })

  it('draws the wait with the masthead mark’s own tile, cell for cell', async () => {
    waiting()
    const { container } = renderAt('/digest')
    await screen.findByText('loading the digest')

    // Borrowed, not redrawn: the pattern and the order of the glint are the
    // same objects the masthead uses, so the two can never disagree about
    // what the brand looks like.
    const read = (scope: string) =>
      [...container.querySelectorAll<HTMLElement>(`${scope} .wordmark-cell`)].map(
        (cell) => `${cell.dataset.level}@${cell.style.getPropertyValue('--glint-step')}`,
      )

    expect(read('.loading-note')).toEqual(read('.masthead'))
    expect(read('.loading-note')).toHaveLength(16)
  })

  it('keeps the masthead mark out of the wait', async () => {
    waiting()
    const { container } = renderAt('/digest')
    await screen.findByText('loading the digest')

    // Two marks moving at once is the product fidgeting, and only one of them
    // is about the thing the User is waiting for. Nothing in the stylesheet
    // can loop the masthead tile, because the class that does is not on it.
    const masthead = container.querySelector('.masthead')
    expect(masthead?.closest('.loading-note')).toBeNull()
    expect(masthead?.querySelector('.loading-note')).toBeNull()
  })

  it('announces the one wait the User asked for, and stays quiet for the rest', async () => {
    // A search replaces something just asked for, so silence would read as
    // nothing having happened. The others replace a screen already being
    // looked at, and a live region on every navigation is noise.
    // The search line only exists once there is a Digest to search.
    stubApi()
      .on('GET /api/digest', {
        body: {
          today: { date: '2026-08-08', volume: 1 },
          groups: [
            {
              date: '2026-08-08',
              label: 'today',
              items: [
                {
                  feedItemId: 3,
                  title: 'First light',
                  feedId: 1,
                  feedTitle: 'Field Notes',
                  link: 'https://journal.example/first-light',
                  publishedAt: '2026-08-08T07:15:00.000Z',
                  displayTime: '07:15',
                  imageUrl: null,
                  summary: null,
                  firstSeenAt: '2026-08-08T09:00:00.000Z',
                  saved: false,
                },
              ],
            },
          ],
          nextCursor: null,
        },
      })
      .on('GET /api/search?q=driftwood', hangs)
    renderAt('/digest')
    const user = userEvent.setup()

    await user.type(await screen.findByRole('searchbox', { name: 'search your reading' }), 'driftwood')

    const searching = await screen.findByRole('status')
    expect(searching.textContent).toBe('searching…')
    expect(searching.querySelectorAll('.wordmark-cell')).toHaveLength(16)
  })

  it('leaves a resting line plain — nothing is happening, so nothing says it is', async () => {
    stubApi()
    renderAt('/digest')

    const note = await screen.findByText(/nothing yet/i)

    expect(note.className).not.toContain('loading-note')
    expect(note.querySelector('.wordmark-grid')).toBeNull()
  })
})
