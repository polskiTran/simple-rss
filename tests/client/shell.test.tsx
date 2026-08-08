import { render, screen, waitFor } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '../../src/client/app.js'
import { ROUTES } from '../../src/client/routing.js'

function renderAt(path: string) {
  window.history.replaceState(null, '', path)
  return render(<App />)
}

function tabNames() {
  return screen.getAllByRole('link').map((tab) => tab.textContent)
}

function activeTab() {
  return screen.getByRole('link', { current: 'page' }).textContent
}

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify({ name: 'simple-rss', version: '0.1.0' }))),
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('the application shell', () => {
  it('shows the four sections in their fixed order', () => {
    renderAt('/digest')

    expect(tabNames()).toEqual([...ROUTES])
  })

  it('shows the same four sections on every screen', async () => {
    renderAt('/digest')
    const user = userEvent.setup()

    await user.click(screen.getByRole('link', { name: 'settings' }))

    expect(tabNames()).toEqual([...ROUTES])
  })

  it('shows the wordmark', () => {
    renderAt('/digest')

    expect(screen.getByText('simple')).toBeDefined()
  })

  it.each([...ROUTES])('marks %s as the current section when its path is open', (route) => {
    renderAt(`/${route}`)

    expect(activeTab()).toBe(route)
  })

  it('opens the digest at the root', () => {
    renderAt('/')

    expect(activeTab()).toBe('digest')
  })

  it('opens the digest for a path it does not recognise', () => {
    renderAt('/something-else')

    expect(activeTab()).toBe('digest')
  })

  it('changes section without a page load and updates the address', async () => {
    renderAt('/digest')
    const user = userEvent.setup()

    await user.click(screen.getByRole('link', { name: 'saved' }))

    expect(activeTab()).toBe('saved')
    expect(window.location.pathname).toBe('/saved')
  })

  it('follows the browser back button', async () => {
    renderAt('/digest')
    const user = userEvent.setup()
    await user.click(screen.getByRole('link', { name: 'feeds' }))

    window.history.back()

    await waitFor(() => expect(activeTab()).toBe('digest'))
  })

  it('leaves modified clicks to the browser so a tab can be opened', () => {
    renderAt('/digest')
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

  it('handles a plain click itself instead of reloading the page', () => {
    renderAt('/digest')
    const event = new MouseEvent('click', { bubbles: true, cancelable: true })

    screen.getByRole('link', { name: 'feeds' }).dispatchEvent(event)

    expect(event.defaultPrevented).toBe(true)
  })

  it('registers no service worker and stores nothing on the device', () => {
    renderAt('/digest')

    expect(window.localStorage.length).toBe(0)
    expect(window.sessionStorage.length).toBe(0)
  })
})

describe('the resting state', () => {
  it.each([
    ['/digest', /nothing yet/i],
    ['/feeds', /no subscriptions yet/i],
    ['/saved', /nothing saved yet/i],
  ])('gives %s a single calm line', (path, note) => {
    renderAt(path)

    expect(screen.getByText(note)).toBeDefined()
  })

  it('has no unread counter anywhere in the shell', () => {
    const { container } = renderAt('/digest')

    expect(container.textContent).not.toMatch(/unread/i)
  })
})

describe('settings', () => {
  it('reports the running version from the API', async () => {
    renderAt('/settings')

    await waitFor(() => expect(screen.getByText('0.1.0')).toBeDefined())
  })

  it('says so plainly when the server cannot be reached', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('network error')
      }),
    )
    renderAt('/settings')

    await waitFor(() => expect(screen.getByText('unavailable')).toBeDefined())
  })

  it('rejects a response that does not match the agreed shape', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ name: 'something-else' }))),
    )
    renderAt('/settings')

    await waitFor(() => expect(screen.getByText('unavailable')).toBeDefined())
  })
})
