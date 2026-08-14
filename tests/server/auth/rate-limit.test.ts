import { beforeEach, describe, expect, it } from 'vitest'
import {
  GLOBAL_FAILURES,
  LoginRateLimiter,
  PER_CLIENT_FAILURES,
  WINDOW_MS,
} from '../../../src/server/auth/rate-limit.js'
import { ManualClock } from '../../support/manual-clock.js'

describe('LoginRateLimiter', () => {
  let clock: ManualClock
  let limiter: LoginRateLimiter

  beforeEach(() => {
    clock = new ManualClock()
    limiter = new LoginRateLimiter(clock)
  })

  function allowed(client: string) {
    const verdict = limiter.begin(client)
    if (!verdict.allowed) throw new Error(`expected ${client} to be allowed`)
    return verdict
  }

  function fail(client: string, times: number): void {
    for (let attempt = 0; attempt < times; attempt += 1) allowed(client).recordFailure()
  }

  it('lets an unknown client through at full speed', () => {
    const attempt = allowed('203.0.113.7')

    expect(attempt.successDelayMs).toBe(0)
    attempt.cancel()
  })

  it('charges a doubling delay for each recorded failure', () => {
    const delays = Array.from({ length: 5 }, () => allowed('203.0.113.7').recordFailure())

    expect(delays).toEqual([250, 500, 1000, 2000, 2000])
  })

  it('blocks once the window holds the per-client limit', () => {
    fail('203.0.113.7', PER_CLIENT_FAILURES)

    const verdict = limiter.begin('203.0.113.7')

    expect(verdict.allowed).toBe(false)
    expect(verdict.retryAfterSeconds).toBe(WINDOW_MS / 1000)
  })

  it('reserves five concurrent checks before any verifier finishes', () => {
    const inFlight = Array.from({ length: PER_CLIENT_FAILURES }, () => allowed('203.0.113.7'))

    expect(limiter.begin('203.0.113.7').allowed).toBe(false)

    inFlight[0]?.cancel()
    expect(limiter.begin('203.0.113.7').allowed).toBe(true)
  })

  it('leaves every other client alone', () => {
    fail('203.0.113.7', PER_CLIENT_FAILURES)

    expect(limiter.begin('198.51.100.9').allowed).toBe(true)
  })

  it('recovers as the oldest failure leaves the window, never permanently', () => {
    fail('203.0.113.7', PER_CLIENT_FAILURES)

    clock.advance(WINDOW_MS + 1)

    expect(allowed('203.0.113.7').successDelayMs).toBe(0)
  })

  it('counts down while the window slides rather than restarting the wait', () => {
    fail('203.0.113.7', PER_CLIENT_FAILURES)
    clock.advance(WINDOW_MS / 3)

    expect(limiter.begin('203.0.113.7').retryAfterSeconds).toBe(Math.ceil((WINDOW_MS * (2 / 3)) / 1000))
  })

  it('unblocks one failure at a time, so a blocked client cannot flood back', () => {
    for (let attempt = 0; attempt < PER_CLIENT_FAILURES; attempt += 1) {
      allowed('203.0.113.7').recordFailure()
      clock.advance(MINUTE)
    }

    clock.advance(WINDOW_MS - PER_CLIENT_FAILURES * MINUTE + 1)

    allowed('203.0.113.7').recordFailure()
    expect(limiter.begin('203.0.113.7').allowed).toBe(false)
  })

  it('forgets a client that signs in successfully', () => {
    fail('203.0.113.7', PER_CLIENT_FAILURES - 1)

    allowed('203.0.113.7').recordSuccess()

    expect(allowed('203.0.113.7').successDelayMs).toBe(0)
  })

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

    expect(allowed('198.51.100.9').successDelayMs).toBe(2000)
  })

  it('never blocks a client for attempts that were not its own', () => {
    saturateAcrossClients()

    expect(limiter.begin('198.51.100.9').allowed).toBe(true)
  })

  it('lets the ceiling drain too', () => {
    saturateAcrossClients()

    clock.advance(WINDOW_MS + 1)

    expect(allowed('198.51.100.9').successDelayMs).toBe(0)
  })
})

const MINUTE = 60 * 1000
