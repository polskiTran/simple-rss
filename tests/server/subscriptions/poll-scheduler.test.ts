import { afterEach, describe, expect, it, vi } from 'vitest'
import { createLogger } from '../../../src/server/logger.js'
import type { FeedRefresh } from '../../../src/server/subscriptions/feed-refresh.js'
import { PollScheduler, WAKE_INTERVAL_MS } from '../../../src/server/subscriptions/poll-scheduler.js'
import type { SubscriptionService } from '../../../src/server/subscriptions/subscription-service.js'

/**
 * The full polling behaviour lives in the application tests, which drive
 * `tick()` explicitly. What only fake timers can show is the wake mechanism
 * itself: the once-per-minute cadence, and that a wake landing on a tick still
 * in flight does nothing.
 */
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

  it('lets a wake that lands mid-tick pass, so the batch bound stays a bound', async () => {
    let frontierQueries = 0
    let finishPoll!: () => void
    const subscriptions = {
      dueFeedIds: () => {
        frontierQueries += 1
        return [1]
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
    expect(frontierQueries).toBe(1)

    finishPoll()
    await Promise.all([first, second])
    expect(frontierQueries).toBe(1)
  })
})
