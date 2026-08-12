import type { Logger } from '../logger.js'
import type { FeedRefresh } from './feed-refresh.js'
import type { SubscriptionService } from './subscription-service.js'

/** The scheduler drives one bounded retention sweep per wake. */
export interface RetentionSweeper {
  sweep(): void
}

export const WAKE_INTERVAL_MS = 60_000

/** Batches poll oldest due time first. */
const DEFAULT_BATCH_LIMIT = 25

const DEFAULT_CONCURRENCY = 4

// A poll that cannot record its outcome leaves its Feed due, so without a
// ceiling a persistence fault would spin the drain loop.
const MAX_BATCHES_PER_WAKE = 20

/** Test seam: production always runs with the defaults above. */
export interface PollSchedulerLimits {
  readonly batchLimit?: number
  readonly concurrency?: number
  /** The test harness disables nudges so every retrieval happens at an explicitly driven wake. */
  readonly nudges?: boolean
}

export interface PollSchedulerOptions extends PollSchedulerLimits {
  readonly subscriptions: SubscriptionService
  readonly refresh: FeedRefresh
  readonly retention: RetentionSweeper
  readonly logger: Logger
}

/**
 * In-process background work (no cron, no queue). Each wake polls a bounded batch of
 * the persisted due-time frontier through `FeedRefresh` — so a Feed is never retrieved
 * twice concurrently — then sweeps retention, after the polls so this wake's
 * observations count before anything is judged expired. Due times are persisted, not
 * timers, so restart catch-up is the ordinary path.
 */
export class PollScheduler {
  readonly #subscriptions: SubscriptionService
  readonly #refresh: FeedRefresh
  readonly #retention: RetentionSweeper
  readonly #logger: Logger
  readonly #batchLimit: number
  readonly #concurrency: number
  readonly #nudges: boolean
  #timer: NodeJS.Timeout | undefined
  #current: Promise<void> | undefined
  #nudged = false

  constructor(options: PollSchedulerOptions) {
    this.#subscriptions = options.subscriptions
    this.#refresh = options.refresh
    this.#retention = options.retention
    this.#logger = options.logger.child({ component: 'scheduler' })
    this.#batchLimit = options.batchLimit ?? DEFAULT_BATCH_LIMIT
    this.#concurrency = options.concurrency ?? DEFAULT_CONCURRENCY
    this.#nudges = options.nudges ?? true
  }

  start(): void {
    if (this.#timer) return
    this.#timer = setInterval(() => void this.tick(), WAKE_INTERVAL_MS)
    // The timer must never hold the process open past a shutdown signal.
    this.#timer.unref()
  }

  stop(): void {
    if (this.#timer) clearInterval(this.#timer)
    this.#timer = undefined
  }

  /** Checks the due frontier now, so a fresh Subscription's first retrieval doesn't wait out a wake. */
  nudge(): void {
    if (!this.#nudges) return
    void this.tick()
  }

  /** A wake arriving while another drains joins it and earns one more drain, not a compounded batch bound. */
  tick(): Promise<void> {
    if (this.#current) {
      this.#nudged = true
      return this.#current
    }
    this.#current = this.#run().finally(() => {
      this.#current = undefined
    })
    return this.#current
  }

  async #run(): Promise<void> {
    // A nudge can land anywhere in a run — even mid-sweep — and must not be swallowed.
    do {
      await this.#drain()
    } while (this.#nudged)
  }

  /** A full batch means more is waiting, so the wake continues instead of trickling one batch a minute. */
  async #drain(): Promise<void> {
    try {
      for (let batches = 0; batches < MAX_BATCHES_PER_WAKE; batches += 1) {
        this.#nudged = false
        const due = this.#subscriptions.dueFeedIds(this.#batchLimit)
        if (due.length > 0) {
          let cursor = 0
          const worker = async (): Promise<void> => {
            for (;;) {
              const feedId = due[cursor]
              cursor += 1
              if (feedId === undefined) return
              await this.#poll(feedId)
            }
          }
          await Promise.all(Array.from({ length: Math.min(this.#concurrency, due.length) }, worker))
          this.#logger.info('scheduler.tick_completed', { due: due.length })
        }
        if (due.length < this.#batchLimit && !this.#nudged) break
      }

      this.#retention.sweep()
    } catch (error) {
      this.#logger.error('scheduler.tick_failed', { error })
    }
  }

  /** One Feed's poll failure never fails the batch. */
  async #poll(feedId: number): Promise<void> {
    try {
      const outcome = await this.#refresh.refresh(feedId)
      this.#logger.debug('scheduler.feed_polled', { feedId, outcome: outcome.kind })
    } catch (error) {
      this.#logger.error('scheduler.feed_poll_failed', { feedId, error })
    }
  }
}
