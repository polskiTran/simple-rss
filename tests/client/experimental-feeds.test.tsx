import { act, render, screen, waitFor } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '../../src/client/app.js'
import { subscription, UNCHECKED, unavailable } from './fixtures.js'
import { stubApi } from './stub-api.js'

beforeEach(() => {
  localStorage.setItem('interface', 'experimental')
  window.history.replaceState(null, '', '/feeds')
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  localStorage.clear()
})

describe('the experimental Feeds screen', () => {
  it('asks again while a Subscription waits for its first check, and stops once it is checked', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'], shouldAdvanceTime: true })
    const api = stubApi().on('GET /api/feeds', { body: { subscriptions: [subscription({ availability: UNCHECKED })] } })
    render(<App />)
    expect(await screen.findByText('Waiting for first check')).toBeDefined()

    api.on('GET /api/feeds', { body: { subscriptions: [subscription()] } })
    await act(() => vi.advanceTimersByTimeAsync(2_000))
    await waitFor(() => expect(screen.queryByText('Waiting for first check')).toBeNull())

    const asked = api.requestsTo('GET /api/feeds').length
    await act(() => vi.advanceTimersByTimeAsync(10_000))
    expect(api.requestsTo('GET /api/feeds')).toHaveLength(asked)
  })

  it('retries an unavailable Subscription by hand and shows it restored', async () => {
    const api = stubApi().on('GET /api/feeds', {
      body: { subscriptions: [subscription({ availability: unavailable() })] },
    })
    api.on('POST /api/feeds/1/refresh', () => {
      api.on('GET /api/feeds', { body: { subscriptions: [subscription()] } })
      return { body: { observedItems: 2 } }
    })
    render(<App />)

    await userEvent.click(await screen.findByRole('button', { name: 'Retry Field Notes' }))

    expect(await screen.findByText('The Feed answered. Checking works again.')).toBeDefined()
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Retry Field Notes' })).toBeNull())
  })
})
