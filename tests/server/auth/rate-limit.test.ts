import { beforeEach, describe, expect, it } from 'vitest'
import {
  GLOBAL_FAILURES,
  LoginRateLimiter,
  PER_CLIENT_FAILURES,
  WINDOW_MS,
} from '../../../src/server/auth/rate-limit.js'
import { ManualClock } from '../../support/manual-clock.js'

/**
 * The sliding-window arithmetic, which has more combinations than it is worth
 * driving through HTTP. `tests/server/authentication.test.ts` covers the same
 * policy as the Owner meets it: five wrong passwords, then a wait.
 */
describe('LoginRateLimiter', () => {
  let clock: ManualClock
  let limiter: LoginRateLimiter

  beforeEach(() => {
    clock = new ManualClock()
    limiter = new LoginRateLimiter(clock)
  })

  function fail(client: string, times: number): void {
    for (let attempt = 0; attempt < times; attempt += 1) limiter.recordFailure(client)
  }

  it('lets an unknown client through at full speed', () => {
    expect(limiter.check('203.0.113.7')).toEqual({ allowed: true, delayMs: 0, retryAfterSeconds: 0 })
  })

  it('charges a doubling delay for each recorded failure', () => {
    const delays = Array.from({ length: 5 }, () => limiter.recordFailure('203.0.113.7'))

    expect(delays).toEqual([250, 500, 1000, 2000, 2000])
  })

  it('blocks once the window holds the per-client limit', () => {
    fail('203.0.113.7', PER_CLIENT_FAILURES)

    const verdict = limiter.check('203.0.113.7')

    expect(verdict.allowed).toBe(false)
    expect(verdict.retryAfterSeconds).toBe(WINDOW_MS / 1000)
  })

  it('leaves every other client alone', () => {
    fail('203.0.113.7', PER_CLIENT_FAILURES)

    expect(limiter.check('198.51.100.9').allowed).toBe(true)
  })

  it('recovers as the oldest failure leaves the window, never permanently', () => {
    fail('203.0.113.7', PER_CLIENT_FAILURES)

    clock.advance(WINDOW_MS + 1)

    expect(limiter.check('203.0.113.7')).toEqual({ allowed: true, delayMs: 0, retryAfterSeconds: 0 })
  })

  it('counts down while the window slides rather than restarting the wait', () => {
    fail('203.0.113.7', PER_CLIENT_FAILURES)
    clock.advance(WINDOW_MS / 3)

    expect(limiter.check('203.0.113.7').retryAfterSeconds).toBe(Math.ceil((WINDOW_MS * (2 / 3)) / 1000))
  })

  it('unblocks one failure at a time, so a blocked client cannot flood back', () => {
    for (let attempt = 0; attempt < PER_CLIENT_FAILURES; attempt += 1) {
      limiter.recordFailure('203.0.113.7')
      clock.advance(MINUTE)
    }

    // The oldest failure has just aged out, freeing exactly one slot.
    clock.advance(WINDOW_MS - PER_CLIENT_FAILURES * MINUTE + 1)

    expect(limiter.check('203.0.113.7').allowed).toBe(true)
    limiter.recordFailure('203.0.113.7')
    expect(limiter.check('203.0.113.7').allowed).toBe(false)
  })

  it('forgets a client that signs in successfully', () => {
    fail('203.0.113.7', PER_CLIENT_FAILURES)

    limiter.recordSuccess('203.0.113.7')

    expect(limiter.check('203.0.113.7')).toEqual({ allowed: true, delayMs: 0, retryAfterSeconds: 0 })
  })

  /**
   * Reaches the global ceiling while keeping every individual client below its
   * own limit — the shape of guessing spread across many addresses, which the
   * per-client rule alone would not notice.
   */
  function saturateAcrossClients(): void {
    let recorded = 0
    for (let host = 1; recorded < GLOBAL_FAILURES; host += 1) {
      const batch = Math.min(PER_CLIENT_FAILURES - 1, GLOBAL_FAILURES - recorded)
      fail(`203.0.113.${host}`, batch)
      recorded += batch
    }
  }

  it('charges every client the maximum delay once the installation hits the ceiling', () => {
    saturateAcrossClients()

    expect(limiter.check('198.51.100.9')).toEqual({ allowed: true, delayMs: 2000, retryAfterSeconds: 0 })
  })

  it('never blocks a client for failures that were not its own', () => {
    saturateAcrossClients()
    saturateAcrossClients()

    // The Owner arriving from an address with a clean history is slowed down
    // but always let through — otherwise anyone with a few addresses could
    // keep them out of their own reader indefinitely.
    expect(limiter.check('198.51.100.9').allowed).toBe(true)
  })

  it('lets the ceiling drain too', () => {
    saturateAcrossClients()

    clock.advance(WINDOW_MS + 1)

    expect(limiter.check('198.51.100.9').delayMs).toBe(0)
  })
})

const MINUTE = 60 * 1000
