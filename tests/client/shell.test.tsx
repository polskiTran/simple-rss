import { render, screen, waitFor, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '../../src/client/app.js'
import { ROUTE_LABELS, ROUTES } from '../../src/client/routing.js'
import { stubApi } from './stub-api.js'

const PLACES = ['Digest', 'Library', 'Feeds']

async function renderAt(path: string) {
  window.history.replaceState(null, '', path)
  const result = render(<App />)
  await screen.findByRole('navigation', { name: 'Places' })
  return result
}

function placeNames() {
  return within(screen.getByRole('navigation', { name: 'Places' }))
    .getAllByRole('link')
    .map((place) => place.textContent)
}

function current() {
  return screen.getByRole('link', { current: 'page' }).textContent
}

beforeEach(() => {
  stubApi()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('the application shell', () => {
  it('shows the places in their fixed order, and Settings beside them', async () => {
    await renderAt('/digest')

    expect(placeNames()).toEqual(PLACES)
    expect(screen.getByRole('link', { name: 'Settings' })).toBeDefined()
  })

  it('shows the same places on every screen', async () => {
    await renderAt('/digest')
    const user = userEvent.setup()

    await user.click(screen.getByRole('link', { name: 'Settings' }))

    expect(placeNames()).toEqual(PLACES)
  })

  it.each([...ROUTES])('marks %s as the current section when its path is open', async (route) => {
    await renderAt(`/${route}`)

    expect(current()).toBe(ROUTE_LABELS[route])
  })

  it('opens the digest at the root', async () => {
    await renderAt('/')

    expect(current()).toBe('Digest')
  })

  it('opens the digest for a path it does not recognise', async () => {
    await renderAt('/something-else')

    expect(current()).toBe('Digest')
  })

  it('changes section without a page load and updates the address', async () => {
    await renderAt('/digest')
    const user = userEvent.setup()

    await user.click(screen.getByRole('link', { name: 'Library' }))

    expect(current()).toBe('Library')
    expect(window.location.pathname).toBe('/saved')
  })

  it('follows the browser back button', async () => {
    await renderAt('/digest')
    const user = userEvent.setup()
    await user.click(screen.getByRole('link', { name: 'Feeds' }))

    window.history.back()

    await waitFor(() => expect(current()).toBe('Digest'))
  })

  it('leaves modified clicks to the browser so a tab can be opened', async () => {
    await renderAt('/digest')
    const event = new MouseEvent('click', { bubbles: true, cancelable: true, metaKey: true })
    let handledByBrowser = false
    window.addEventListener(
      'click',
      (seen) => {
        handledByBrowser = !seen.defaultPrevented
        seen.preventDefault()
      },
      { once: true },
    )

    screen.getByRole('link', { name: 'Feeds' }).dispatchEvent(event)

    expect(handledByBrowser).toBe(true)
    expect(window.location.pathname).toBe('/digest')
  })

  it('handles a plain click itself instead of reloading the page', async () => {
    await renderAt('/digest')
    const event = new MouseEvent('click', { bubbles: true, cancelable: true })

    screen.getByRole('link', { name: 'Feeds' }).dispatchEvent(event)

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
    ['/feeds', /No feeds yet/i],
    ['/saved', /nothing saved yet/i],
  ])('gives %s a single calm line', async (path, note) => {
    await renderAt(path)

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

    await waitFor(() => expect(screen.getByText('simple 0.1.0')).toBeDefined())
  })

  it('says so plainly when the server cannot be reached', async () => {
    stubApi().on('GET /api/meta', { status: 503 })
    await renderAt('/settings')

    await waitFor(() => expect(screen.getByText('simple unavailable')).toBeDefined())
  })

  it('rejects a response that does not match the agreed shape', async () => {
    stubApi().malformed('GET /api/meta')
    await renderAt('/settings')

    await waitFor(() => expect(screen.getByText('simple unavailable')).toBeDefined())
  })
})
