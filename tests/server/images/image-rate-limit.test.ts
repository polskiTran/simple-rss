import { describe, expect, it } from 'vitest'
import {
  ImageRateLimiter,
  IMAGE_REQUESTS_PER_WINDOW,
  IMAGE_WINDOW_MS,
} from '../../../src/server/images/image-rate-limit.js'
import { ManualClock } from '../../support/manual-clock.js'

describe('image rate limiting', () => {
  it('allows a full window, refuses the next request, then opens a fresh window', () => {
    const clock = new ManualClock()
    const limiter = new ImageRateLimiter(clock)

    for (let index = 0; index < IMAGE_REQUESTS_PER_WINDOW; index += 1) {
      expect(limiter.allow('phone').allowed).toBe(true)
    }

    const refused = limiter.allow('phone')
    expect(refused.allowed).toBe(false)
    if (!refused.allowed) expect(refused.retryAfterSeconds).toBeGreaterThan(0)

    clock.advance(IMAGE_WINDOW_MS)
    expect(limiter.allow('phone').allowed).toBe(true)
  })

  it('counts each client address on its own', () => {
    const limiter = new ImageRateLimiter(new ManualClock())

    for (let index = 0; index < IMAGE_REQUESTS_PER_WINDOW; index += 1) limiter.allow('phone')
    expect(limiter.allow('phone').allowed).toBe(false)
    expect(limiter.allow('laptop').allowed).toBe(true)
  })

  it('names a wait no longer than the window itself', () => {
    const clock = new ManualClock()
    const limiter = new ImageRateLimiter(clock)

    for (let index = 0; index < IMAGE_REQUESTS_PER_WINDOW; index += 1) limiter.allow('phone')
    clock.advance(IMAGE_WINDOW_MS - 1000)

    const refused = limiter.allow('phone')
    expect(refused.allowed).toBe(false)
    if (!refused.allowed) expect(refused.retryAfterSeconds).toBe(1)
  })
})
