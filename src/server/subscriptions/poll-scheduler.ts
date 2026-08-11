import type { Logger } from '../logger.js'
import type { FeedRefresh } from './feed-refresh.js'
import type { SubscriptionService } from './subscription-service.js'

/** The slice of retention the scheduler drives: one bounded sweep per wake. */
export interface RetentionSweeper {
  sweep(): void
}

/** The scheduler sleeps this long between looks at the due-time frontier. */
export const WAKE_INTERVAL_MS = 60_000

/** How many due Subscriptions one batch polls, oldest frontier first. */
const DEFAULT_BATCH_LIMIT = 25

/** How many of one batch are in flight at once. */
const DEFAULT_CONCURRENCY = 4

/**
 * The most batches one wake drains. A poll that cannot record its outcome
 * leaves its Feed due, so without a ceiling a persistence fault would spin
 * the drain loop; at the ceiling the backlog waits for the next wake.
 */
const MAX_BATCHES_PER_WAKE = 20

/** Test seam: production always runs with the defaults above. */
export interface PollSchedulerLimits {
  readonly batchLimit?: number
  readonly concurrency?: number
  /**
   * Whether a nudge wakes the scheduler. The test harness turns this off so
   * every retrieval happens at an explicitly driven wake; production keeps it.
   */
  readonly nudges?: boolean
}

export interface PollSchedulerOptions extends PollSchedulerLimits {
  readonly subscriptions: SubscriptionService
  readonly refresh: FeedRefresh
  readonly retention: RetentionSweeper
  readonly logger: Logger
}

/**
 * Background work inside the one application process: no OS cron, no queue,
 * no second service. Once a minute it asks the persisted due-time frontier
 * what has become due, polls a bounded batch of it, and then runs one bounded
 * retention sweep — after the polls, so this wake's own observations count
 * before anything is judged expired.
 *
 * Because due times are persisted rather than held as timers, work missed
 * during downtime is simply still due at the next wake — catch-up after a
 * restart is the ordinary path, not a special one.
 *
 * Polling goes through `FeedRefresh`, the same door a manual refresh uses, so
 * one Feed is never retrieved twice concurrently no matter who asked.
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

  /**
   * Asks for a look at the due frontier right away, so a fresh Subscription's
   * first retrieval starts within moments instead of at the next wake.
   */
  nudge(): void {
    if (!this.#nudges) return
    void this.tick()
  }

  /**
   * One wake. A wake that arrives while another is draining joins it and
   * earns one more drain, rather than compounding the batch bound.
   */
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
    // A nudge can land anywhere in a run — even during the retention sweep —
    // and must not be swallowed, or its Subscription waits out a whole wake.
    do {
      await this.#drain()
    } while (this.#nudged)
  }

  /**
   * Drains the frontier batch by batch: a full batch means more is waiting,
   * so the wake continues at once instead of trickling one batch a minute.
   */
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

  /** One Feed's poll; its failure is that Feed's alone, never the batch's. */
  async #poll(feedId: number): Promise<void> {
    try {
      const outcome = await this.#refresh.refresh(feedId)
      this.#logger.debug('scheduler.feed_polled', { feedId, outcome: outcome.kind })
    } catch (error) {
      this.#logger.error('scheduler.feed_poll_failed', { feedId, error })
    }
  }
}
