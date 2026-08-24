import { afterEach, describe, expect, it, vi } from 'vitest'
import { createLogger } from '../../../src/server/logger.js'
import type { FeedRefresh } from '../../../src/server/subscriptions/feed-refresh.js'
import { PollScheduler, WAKE_INTERVAL_MS } from '../../../src/server/subscriptions/poll-scheduler.js'
import type { SubscriptionService } from '../../../src/server/subscriptions/subscription-service.js'

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
    } satisfies Pick<SubscriptionService, 'dueFeedIds'>

    const scheduler = new PollScheduler({
      subscriptions,
      refresh: { refresh: () => Promise.reject(new Error('unexpected refresh')) },
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
    const subscriptions = {
      dueFeedIds: () => {
        frontierQueries += 1
        return frontierQueries === 1 ? [1] : []
      },
    } satisfies Pick<SubscriptionService, 'dueFeedIds'>
    const refreshCompletion = Promise.withResolvers<{ readonly kind: 'updated'; readonly observedItems: number }>()
    const refresh = {
      refresh: () => refreshCompletion.promise,
    } satisfies Pick<FeedRefresh, 'refresh'>

    const scheduler = new PollScheduler({
      subscriptions,
      refresh,
      retention: { sweep: () => {} },
      logger: quietLogger(),
    })
    const first = scheduler.tick()
    const second = scheduler.tick()
    expect(frontierQueries).toBe(1)

    refreshCompletion.resolve({ kind: 'updated', observedItems: 0 })
    await Promise.all([first, second])
    expect(frontierQueries).toBe(2)
  })
})
