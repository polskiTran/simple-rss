import { render, screen, waitFor, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '../../src/client/app.js'
import { ROUTES } from '../../src/client/routing.js'
import { stubApi } from './stub-api.js'

// Renders the shell for a signed-in User and waits for the first status
// answer — the tabs do not render until it lands.
async function renderAt(path: string) {
  window.history.replaceState(null, '', path)
  const result = render(<App />)
  await screen.findByRole('navigation', { name: 'Sections' })
  return result
}

function tabNames() {
  // Scoped to the tab bar: a view behind it may hold links of its own, like
  // the Settings export downloads.
  const sections = screen.getByRole('navigation', { name: 'Sections' })
  return within(sections).getAllByRole('link').map((tab) => tab.textContent)
}

function activeTab() {
  return screen.getByRole('link', { current: 'page' }).textContent
}

beforeEach(() => {
  stubApi()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('the application shell', () => {
  it('shows the four sections in their fixed order', async () => {
    await renderAt('/digest')

    expect(tabNames()).toEqual([...ROUTES])
  })

  it('shows the same four sections on every screen', async () => {
    await renderAt('/digest')
    const user = userEvent.setup()

    await user.click(screen.getByRole('link', { name: 'settings' }))

    expect(tabNames()).toEqual([...ROUTES])
  })

  it('shows the wordmark', async () => {
    await renderAt('/digest')

    expect(screen.getByText('simple')).toBeDefined()
  })

  it('returns to the digest when the mark is pressed', async () => {
    await renderAt('/saved')
    const user = userEvent.setup()

    await user.click(screen.getByRole('link', { name: 'simple' }))

    expect(activeTab()).toBe('digest')
    expect(window.location.pathname).toBe('/digest')
  })

  it('leaves the digest tab the only current one when the mark is a link', async () => {
    await renderAt('/saved')

    // `getByRole` throws on a second match: the mark must not claim the page
    // alongside the tab that says where the User is.
    expect(activeTab()).toBe('saved')
  })

  it('draws the mark as the 4x4 cadence tile of docs/references/brand.png', async () => {
    const { container } = await renderAt('/digest')

    // The pattern is the design: sixteen cells, row by row, in the cadence
    // ramp's levels. The tile is aria-hidden decoration, hence the class query.
    const levels = [...container.querySelectorAll('.masthead .wordmark-cell')].map((cell) =>
      cell.getAttribute('data-level'),
    )

    expect(levels).toEqual(['4', '1', '3', '0', '2', '4', '0', '2', '3', '0', '4', '1', '0', '2', '1', '3'])
    expect(container.querySelector('.masthead .wordmark-grid')?.getAttribute('aria-hidden')).toBe('true')
  })

  it('orders the hover glint along the tile’s anti-diagonal', async () => {
    const { container } = await renderAt('/digest')

    // `row + col`: the glint crosses against the leading diagonal the peak
    // cells sit on. Every cell carries its step even without a pointer.
    const steps = [...container.querySelectorAll<HTMLElement>('.masthead .wordmark-cell')].map(
      (cell) => cell.style.getPropertyValue('--glint-step'),
    )

    expect(steps).toEqual(['0', '1', '2', '3', '1', '2', '3', '4', '2', '3', '4', '5', '3', '4', '5', '6'])
  })

  it.each([...ROUTES])('marks %s as the current section when its path is open', async (route) => {
    await renderAt(`/${route}`)

    expect(activeTab()).toBe(route)
  })

  it('opens the digest at the root', async () => {
    await renderAt('/')

    expect(activeTab()).toBe('digest')
  })

  it('opens the digest for a path it does not recognise', async () => {
    await renderAt('/something-else')

    expect(activeTab()).toBe('digest')
  })

  it('changes section without a page load and updates the address', async () => {
    await renderAt('/digest')
    const user = userEvent.setup()

    await user.click(screen.getByRole('link', { name: 'saved' }))

    expect(activeTab()).toBe('saved')
    expect(window.location.pathname).toBe('/saved')
  })

  it('follows the browser back button', async () => {
    await renderAt('/digest')
    const user = userEvent.setup()
    await user.click(screen.getByRole('link', { name: 'feeds' }))

    window.history.back()

    await waitFor(() => expect(activeTab()).toBe('digest'))
  })

  it('leaves modified clicks to the browser so a tab can be opened', async () => {
    await renderAt('/digest')
    const event = new MouseEvent('click', { bubbles: true, cancelable: true, metaKey: true })
    // Records the verdict after React has had the event, then stops jsdom
    // from attempting a real navigation it cannot perform.
    let handledByBrowser = false
    window.addEventListener(
      'click',
      (seen) => {
        handledByBrowser = !seen.defaultPrevented
        seen.preventDefault()
      },
      { once: true },
    )

    screen.getByRole('link', { name: 'feeds' }).dispatchEvent(event)

    expect(handledByBrowser).toBe(true)
    expect(window.location.pathname).toBe('/digest')
  })

  it('handles a plain click itself instead of reloading the page', async () => {
    await renderAt('/digest')
    const event = new MouseEvent('click', { bubbles: true, cancelable: true })

    screen.getByRole('link', { name: 'feeds' }).dispatchEvent(event)

    expect(event.defaultPrevented).toBe(true)
  })

  it('registers no service worker and stores nothing on the device', async () => {
    await renderAt('/digest')

    expect(window.localStorage.length).toBe(0)
    expect(window.sessionStorage.length).toBe(0)
  })
})

describe('the resting state', () => {
  it.each([
    ['/digest', /nothing yet/i],
    ['/feeds', /no subscriptions yet/i],
    ['/saved', /nothing saved yet/i],
  ])('gives %s a single calm line', async (path, note) => {
    await renderAt(path)

    // The note appears once the section's own fetch settles, which the
    // navigation landmark `renderAt` waits for does not guarantee.
    expect(await screen.findByText(note)).toBeDefined()
  })

  it('has no unread counter anywhere in the shell', async () => {
    const { container } = await renderAt('/digest')

    expect(container.textContent).not.toMatch(/unread/i)
  })
})

describe('settings', () => {
  it('reports the running version from the API', async () => {
    await renderAt('/settings')

    await waitFor(() => expect(screen.getByText('0.1.0')).toBeDefined())
  })

  it('says so plainly when the server cannot be reached', async () => {
    stubApi().on('GET /api/meta', { status: 503 })
    await renderAt('/settings')

    await waitFor(() => expect(screen.getByText('unavailable')).toBeDefined())
  })

  it('rejects a response that does not match the agreed shape', async () => {
    stubApi().on('GET /api/meta', { body: { name: 'something-else' } })
    await renderAt('/settings')

    await waitFor(() => expect(screen.getByText('unavailable')).toBeDefined())
  })
})
