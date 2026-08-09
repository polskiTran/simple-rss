import { render, screen, waitFor } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App } from '../../src/client/app.js'
import { stubApi } from './stub-api.js'

afterEach(() => {
  vi.unstubAllGlobals()
  localStorage.clear()
  delete document.documentElement.dataset['appearance']
})

function openSettings() {
  window.history.replaceState(null, '', '/settings')
  render(<App />)
}

describe('the Settings timezone', () => {
  it('shows the installation timezone the server holds', async () => {
    stubApi().on('GET /api/settings', { body: { timezone: 'Pacific/Auckland' } })
    openSettings()

    expect(await screen.findByLabelText('installation timezone')).toHaveProperty('value', 'Pacific/Auckland')
  })

  it('lets the Owner change it, sending the choice to the installation', async () => {
    const api = stubApi().on('PUT /api/settings/timezone', (request) => ({
      body: { timezone: (request.body as { timezone: string }).timezone },
    }))
    openSettings()
    const user = userEvent.setup()

    const select = await screen.findByLabelText('installation timezone')
    await user.selectOptions(select, 'Pacific/Auckland')

    await waitFor(() => expect(select).toHaveProperty('value', 'Pacific/Auckland'))
    expect(api.requestsTo('PUT /api/settings/timezone')[0]?.body).toEqual({ timezone: 'Pacific/Auckland' })
  })

  it('keeps the held timezone and says so when the server refuses the choice', async () => {
    stubApi().on('PUT /api/settings/timezone', {
      status: 400,
      body: { error: { code: 'unknown_timezone', message: 'That is not a recognizable IANA timezone' } },
    })
    openSettings()
    const user = userEvent.setup()

    const select = await screen.findByLabelText('installation timezone')
    await user.selectOptions(select, 'Pacific/Auckland')

    expect(await screen.findByText('that timezone is not recognized')).toBeDefined()
    expect(select).toHaveProperty('value', 'UTC')
  })
})

describe('the Settings export actions', () => {
  it('offers the OPML and complete JSON downloads as plain links', async () => {
    stubApi()
    openSettings()

    const opml = await screen.findByRole('link', { name: 'subscriptions (OPML)' })
    expect(opml.getAttribute('href')).toBe('/api/subscriptions/export')
    expect(opml.getAttribute('download')).toBe('subscriptions.opml')

    const json = screen.getByRole('link', { name: 'everything (JSON)' })
    expect(json.getAttribute('href')).toBe('/api/export')
    expect(json.getAttribute('download')).toBe('simple-rss-export.json')
  })
})

describe('the Settings appearance', () => {
  it('offers system, light, and dark, resting on system', async () => {
    stubApi()
    openSettings()

    expect(await screen.findByRole('button', { name: 'system' })).toBeDefined()
    expect(screen.getByRole('button', { name: 'system' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: 'light' }).getAttribute('aria-pressed')).toBe('false')
    expect(screen.getByRole('button', { name: 'dark' }).getAttribute('aria-pressed')).toBe('false')
  })

  it('pins a chosen scheme on this device without asking the server', async () => {
    const api = stubApi()
    openSettings()
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'dark' }))

    expect(screen.getByRole('button', { name: 'dark' }).getAttribute('aria-pressed')).toBe('true')
    expect(document.documentElement.dataset['appearance']).toBe('dark')
    expect(localStorage.getItem('appearance')).toBe('dark')
    // Appearance is a device preference; no request carried it anywhere.
    expect(api.requests.filter(({ method }) => method !== 'GET')).toEqual([])
  })

  it('returns to following the device when system is chosen again', async () => {
    stubApi()
    openSettings()
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'dark' }))
    await user.click(screen.getByRole('button', { name: 'system' }))

    expect(document.documentElement.dataset['appearance']).toBeUndefined()
    expect(localStorage.getItem('appearance')).toBeNull()
  })
})
