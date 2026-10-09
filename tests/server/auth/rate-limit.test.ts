import { beforeEach, describe, expect, it } from 'vitest'
import {
  GLOBAL_FAILURES,
  LoginRateLimiter,
  PER_CLIENT_FAILURES,
  WINDOW_MS,
} from '../../../src/server/auth/rate-limit.js'
import { ManualClock } from '../../support/manual-clock.js'

const MINUTE = 60 * 1000

// The canonical rate-limit behaviour is pinned over HTTP in `authentication.test.ts`.
// These cover the edges a request cannot arrange: time inside the window, and cancellation.
describe('LoginRateLimiter', () => {
  let clock: ManualClock
  let limiter: LoginRateLimiter

  beforeEach(() => {
    clock = new ManualClock()
    limiter = new LoginRateLimiter(clock)
  })

  function allowed(client: string) {
    const verdict = limiter.begin(client)
    if (verdict.kind !== 'allowed') throw new Error(`expected ${client} to be allowed`)
    return verdict
  }

  function refused(client: string) {
    const verdict = limiter.begin(client)
    if (verdict.kind !== 'refused') throw new Error(`expected ${client} to be refused`)
    return verdict
  }

  function fail(client: string, times: number): void {
    for (let attempt = 0; attempt < times; attempt += 1) allowed(client).recordFailure()
  }

  it('gives a cancelled check its reservation back', () => {
    const inFlight = Array.from({ length: PER_CLIENT_FAILURES }, () => allowed('203.0.113.7'))

    inFlight[0]?.cancel()

    expect(limiter.begin('203.0.113.7').kind).toBe('allowed')
  })

  it('keeps a recorded failure even if the check is cancelled afterwards', () => {
    fail('203.0.113.7', PER_CLIENT_FAILURES - 1)
    const last = allowed('203.0.113.7')

    last.recordFailure()
    last.cancel()

    expect(limiter.begin('203.0.113.7').kind).toBe('refused')
  })

  it('counts down while the window slides rather than restarting the wait', () => {
    fail('203.0.113.7', PER_CLIENT_FAILURES)
    clock.advance(WINDOW_MS / 3)

    expect(refused('203.0.113.7').retryAfterSeconds).toBe(Math.ceil((WINDOW_MS * (2 / 3)) / 1000))
  })

  it('unblocks one failure at a time, so a blocked client cannot flood back', () => {
    for (let attempt = 0; attempt < PER_CLIENT_FAILURES; attempt += 1) {
      allowed('203.0.113.7').recordFailure()
      clock.advance(MINUTE)
    }

    clock.advance(WINDOW_MS - PER_CLIENT_FAILURES * MINUTE + 1)

    allowed('203.0.113.7').recordFailure()
    expect(limiter.begin('203.0.113.7').kind).toBe('refused')
  })

  it('lets the global ceiling drain too', () => {
    let recorded = 0
    for (let host = 1; recorded < GLOBAL_FAILURES; host += 1) {
      const batch = Math.min(PER_CLIENT_FAILURES - 1, GLOBAL_FAILURES - recorded)
      fail(`203.0.113.${host}`, batch)
      recorded += batch
    }

    clock.advance(WINDOW_MS + 1)

    expect(allowed('198.51.100.9').successDelayMs).toBe(0)
  })
})
