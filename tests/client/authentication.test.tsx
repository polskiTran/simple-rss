import { render, screen, waitFor } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App } from '../../src/client/app.js'
import { StubbedApi, stubApi } from './stub-api.js'

function renderApp(path = '/digest') {
  window.history.replaceState(null, '', path)
  return render(<App />)
}

async function fill(label: string, value: string) {
  await userEvent.type(screen.getByLabelText(label), value)
}

async function press(name: string) {
  await userEvent.click(screen.getByRole('button', { name }))
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('an installation nobody has claimed', () => {
  it('offers setup rather than a password nobody has chosen', async () => {
    stubApi({ claimed: false, authenticated: false })

    renderApp()

    expect(await screen.findByLabelText('setup secret')).toBeDefined()
    expect(screen.queryByRole('navigation', { name: 'Sections' })).toBeNull()
  })

  it('names the screen, so it is not an unlabelled group of password boxes', async () => {
    stubApi({ claimed: false, authenticated: false })

    renderApp()

    expect(await screen.findByRole('form', { name: 'Claim this installation' })).toBeDefined()
  })

  it('sends the secret and the chosen password, and opens the reader', async () => {
    const api = stubApi({ claimed: false, authenticated: false }).on('POST /api/auth/setup', {
      status: 201,
      body: { claimed: true, authenticated: true },
    })
    renderApp()
    await screen.findByLabelText('setup secret')

    await fill('setup secret', 'a-deployment-setup-secret')
    await fill('password', 'a-calm-reading-password')
    await fill('confirm password', 'a-calm-reading-password')
    await press('claim')

    expect(api.requestsTo('POST /api/auth/setup')[0]?.body).toEqual({
      setupSecret: 'a-deployment-setup-secret',
      password: 'a-calm-reading-password',
      // Claiming offers this device's own zone, so the installation timezone
      // is detected during setup rather than defaulting to UTC.
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    })
    expect(await screen.findByRole('navigation', { name: 'Sections' })).toBeDefined()
  })

  it('refuses to send two passwords that do not match', async () => {
    const api = stubApi({ claimed: false, authenticated: false })
    renderApp()
    await screen.findByLabelText('setup secret')

    await fill('setup secret', 'a-deployment-setup-secret')
    await fill('password', 'a-calm-reading-password')
    await fill('confirm password', 'a-clam-reading-password')
    await press('claim')

    expect(await screen.findByText(/not the same/i)).toBeDefined()
    expect(api.requestsTo('POST /api/auth/setup')).toHaveLength(0)
  })

  it('says a password is too short before spending a request on it', async () => {
    const api = stubApi({ claimed: false, authenticated: false })
    renderApp()
    await screen.findByLabelText('setup secret')

    await fill('setup secret', 'a-deployment-setup-secret')
    await fill('password', 'short')
    await fill('confirm password', 'short')
    await press('claim')

    expect(await screen.findByText(/at least 12 characters/i)).toBeDefined()
    expect(api.requestsTo('POST /api/auth/setup')).toHaveLength(0)
  })

  it('rejects a password beyond the UTF-8 hashing limit before sending it', async () => {
    const api = stubApi({ claimed: false, authenticated: false })
    renderApp()
    await screen.findByLabelText('setup secret')
    const password = '界'.repeat(400)

    await fill('setup secret', 'a-deployment-setup-secret')
    await fill('password', password)
    await fill('confirm password', password)
    await press('claim')

    expect(await screen.findByText(/password is too long/i)).toBeDefined()
    expect(api.requestsTo('POST /api/auth/setup')).toHaveLength(0)
  })

  it('says plainly that the setup secret was wrong', async () => {
    stubApi({ claimed: false, authenticated: false }).on('POST /api/auth/setup', {
      status: 401,
      body: { error: { code: 'invalid_credentials', message: 'Invalid credentials' } },
    })
    renderApp()
    await screen.findByLabelText('setup secret')

    await fill('setup secret', 'not-the-setup-secret')
    await fill('password', 'a-calm-reading-password')
    await fill('confirm password', 'a-calm-reading-password')
    await press('claim')

    expect(await screen.findByText(/setup secret is not right/i)).toBeDefined()
  })

  it('moves to the sign-in screen when someone else claimed it first', async () => {
    const api = new StubbedApi({ claimed: false, authenticated: false }).on('POST /api/auth/setup', {
      status: 409,
      body: { error: { code: 'already_claimed', message: 'This installation already has an Owner' } },
    })
    api.install()
    renderApp()
    await screen.findByLabelText('setup secret')
    api.authStatus({ claimed: true, authenticated: false })

    await fill('setup secret', 'a-deployment-setup-secret')
    await fill('password', 'a-calm-reading-password')
    await fill('confirm password', 'a-calm-reading-password')
    await press('claim')

    await waitFor(() => expect(screen.getByRole('button', { name: 'sign in' })).toBeDefined())
    expect(screen.queryByLabelText('setup secret')).toBeNull()
  })
})

describe('coming back to a claimed installation', () => {
  it('asks only for the password, and offers no way to register', async () => {
    stubApi({ claimed: true, authenticated: false })

    renderApp()

    expect(await screen.findByLabelText('password')).toBeDefined()
    expect(screen.queryByLabelText('setup secret')).toBeNull()
    expect(screen.queryByRole('navigation', { name: 'Sections' })).toBeNull()
  })

  it('opens the reader once the password is accepted', async () => {
    stubApi({ claimed: true, authenticated: false }).on('POST /api/auth/session', {
      body: { claimed: true, authenticated: true },
    })
    renderApp()
    await screen.findByLabelText('password')

    await fill('password', 'a-calm-reading-password')
    await press('sign in')

    expect(await screen.findByRole('navigation', { name: 'Sections' })).toBeDefined()
  })

  it('says only that the password was wrong', async () => {
    stubApi({ claimed: true, authenticated: false }).on('POST /api/auth/session', {
      status: 401,
      body: { error: { code: 'invalid_credentials', message: 'Invalid credentials' } },
    })
    renderApp()
    await screen.findByLabelText('password')

    await fill('password', 'the-wrong-password')
    await press('sign in')

    const notice = await screen.findByText(/that password is not right/i)
    expect(notice.textContent).not.toMatch(/owner|claimed|attempt/i)
  })

  it('clears the field after a refusal, so the next attempt starts clean', async () => {
    stubApi({ claimed: true, authenticated: false }).on('POST /api/auth/session', {
      status: 401,
      body: { error: { code: 'invalid_credentials', message: 'Invalid credentials' } },
    })
    renderApp()
    await screen.findByLabelText('password')

    await fill('password', 'the-wrong-password')
    await press('sign in')

    await screen.findByText(/not right/i)
    expect(screen.getByLabelText('password')).toHaveProperty('value', '')
  })

  it('passes on how long to wait when the installation is refusing attempts', async () => {
    stubApi({ claimed: true, authenticated: false }).on('POST /api/auth/session', {
      status: 429,
      headers: { 'retry-after': '600' },
      body: { error: { code: 'too_many_attempts', message: 'Too many attempts' } },
    })
    renderApp()
    await screen.findByLabelText('password')

    await fill('password', 'a-calm-reading-password')
    await press('sign in')

    expect(await screen.findByText(/too many attempts — try again in 10 minutes/i)).toBeDefined()
  })

  it('says the reader is unavailable when the server cannot be reached at all', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('network error')
      }),
    )

    renderApp()

    expect(await screen.findByText(/the reader is unavailable/i)).toBeDefined()
  })
})

describe('leaving the reader', () => {
  it('signs out and returns to the sign-in screen', async () => {
    const api = stubApi().on('DELETE /api/auth/session', { status: 204 })
    renderApp('/settings')
    await screen.findByRole('navigation', { name: 'Sections' })

    await press('sign out')

    expect(api.requestsTo('DELETE /api/auth/session')).toHaveLength(1)
    expect(await screen.findByRole('button', { name: 'sign in' })).toBeDefined()
  })

  it('changes the password and says every device must sign in again', async () => {
    const api = stubApi().on('POST /api/auth/password', { body: { claimed: true, authenticated: false } })
    renderApp('/settings')
    await screen.findByRole('navigation', { name: 'Sections' })

    await press('change')
    await fill('current password', 'a-calm-reading-password')
    await fill('new password', 'a-replacement-password')
    await fill('confirm new password', 'a-replacement-password')
    await press('change password')

    expect(api.requestsTo('POST /api/auth/password')[0]?.body).toEqual({
      currentPassword: 'a-calm-reading-password',
      newPassword: 'a-replacement-password',
    })
    expect(await screen.findByRole('button', { name: 'sign in' })).toBeDefined()
  })

  it('warns before the change that it signs out every device', async () => {
    stubApi()
    renderApp('/settings')
    await screen.findByRole('navigation', { name: 'Sections' })

    await press('change')

    expect(screen.getByText(/signs out every device/i)).toBeDefined()
  })

  it('keeps the Owner where they are when the current password is wrong', async () => {
    stubApi().on('POST /api/auth/password', {
      status: 401,
      body: { error: { code: 'invalid_credentials', message: 'Invalid credentials' } },
    })
    renderApp('/settings')
    await screen.findByRole('navigation', { name: 'Sections' })

    await press('change')
    await fill('current password', 'not-the-current-one')
    await fill('new password', 'a-replacement-password')
    await fill('confirm new password', 'a-replacement-password')
    await press('change password')

    expect(await screen.findByText(/that password is not right/i)).toBeDefined()
    expect(screen.getByRole('navigation', { name: 'Sections' })).toBeDefined()
  })

  it('returns to the sign-in screen when a session ends between requests', async () => {
    stubApi().on('GET /api/meta', {
      status: 401,
      body: { error: { code: 'unauthenticated', message: 'Authentication required' } },
    })

    renderApp('/settings')

    expect(await screen.findByRole('button', { name: 'sign in' })).toBeDefined()
  })
})
