import { afterEach, describe, expect, it, vi } from 'vitest'
import { createLogger } from '../../../src/server/logger.js'
import type { FeedRefresh } from '../../../src/server/subscriptions/feed-refresh.js'
import { PollScheduler, WAKE_INTERVAL_MS } from '../../../src/server/subscriptions/poll-scheduler.js'
import type { SubscriptionService } from '../../../src/server/subscriptions/subscription-service.js'

// Full polling behaviour lives in the application tests via explicit `tick()`.
// Only fake timers can show the wake itself: the once-per-minute cadence, and
// that a wake landing on an in-flight tick does nothing.
describe('poll scheduler wakes', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  const quietLogger = () => createLogger({ level: 'error', sink: () => {} })

  it('looks at the due frontier once per minute between start and stop', async () => {
    vi.useFakeTimers()
    let wakes = 0
    const subscriptions = {
      dueFeedIds: () => {
        wakes += 1
        return []
      },
    } as unknown as SubscriptionService

    const scheduler = new PollScheduler({
      subscriptions,
      refresh: {} as FeedRefresh,
      retention: { sweep: () => {} },
      logger: quietLogger(),
    })
    scheduler.start()
    expect(wakes).toBe(0)

    await vi.advanceTimersByTimeAsync(WAKE_INTERVAL_MS - 1)
    expect(wakes).toBe(0)
    await vi.advanceTimersByTimeAsync(1)
    expect(wakes).toBe(1)
    await vi.advanceTimersByTimeAsync(2 * WAKE_INTERVAL_MS)
    expect(wakes).toBe(3)

    scheduler.stop()
    await vi.advanceTimersByTimeAsync(5 * WAKE_INTERVAL_MS)
    expect(wakes).toBe(3)
  })

  it('joins a wake that lands mid-drain: one more look at the frontier, never a second drain', async () => {
    let frontierQueries = 0
    let finishPoll!: () => void
    const subscriptions = {
      dueFeedIds: () => {
        frontierQueries += 1
        return frontierQueries === 1 ? [1] : []
      },
    } as unknown as SubscriptionService
    const refresh = {
      refresh: () =>
        new Promise((resolve) => {
          finishPoll = () => resolve({ kind: 'updated', observedItems: 0 })
        }),
    } as unknown as FeedRefresh

    const scheduler = new PollScheduler({
      subscriptions,
      refresh,
      retention: { sweep: () => {} },
      logger: quietLogger(),
    })
    const first = scheduler.tick()
    const second = scheduler.tick()
    // The joined wake did not start polling on its own: the batch bound holds.
    expect(frontierQueries).toBe(1)

    finishPoll()
    await Promise.all([first, second])
    // …but its request was heard: the frontier was examined once more, so a
    // Subscription recorded mid-drain is not left waiting for the next wake.
    expect(frontierQueries).toBe(2)
  })
})
