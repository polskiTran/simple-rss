import { and, eq, inArray, isNull, lte } from 'drizzle-orm'
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import type { Clock } from '../clock.js'
import type { Logger } from '../logger.js'
import type { SqliteDatabase } from '../persistence/database.js'
import { feedItems, feeds, libraryItems, subscriptions } from '../persistence/schema.js'

/** How long an unsaved Feed Item outlives its last Feed Window observation. */
export const RETENTION_PERIOD_DAYS = 90

const RETENTION_PERIOD_MS = RETENTION_PERIOD_DAYS * 24 * 60 * 60 * 1_000

/** How many rows one sweep removes per rule; the rest wait for the next wake. */
const DEFAULT_BATCH_LIMIT = 500

/** Test seam: production always runs with the default above. */
export interface RetentionLimits {
  readonly batchLimit?: number
}

export interface RetentionServiceOptions extends RetentionLimits {
  readonly database: SqliteDatabase
  readonly clock: Clock
  readonly logger: Logger
}

/**
 * Bounds ordinary history without ever touching an intentional save. A sweep derives
 * from persisted state and the clock — idempotent and restart-safe — and an item a Feed
 * still exposes keeps being re-observed, so it never ages out. It cannot race a poll:
 * eligibility is last-observed time, which a completing poll advances, and both sides
 * serialize on the one SQLite connection.
 */
export class RetentionService {
  readonly #db: BetterSQLite3Database
  readonly #clock: Clock
  readonly #logger: Logger
  readonly #batchLimit: number

  constructor(options: RetentionServiceOptions) {
    this.#db = drizzle(options.database)
    this.#clock = options.clock
    this.#logger = options.logger.child({ component: 'retention' })
    this.#batchLimit = options.batchLimit ?? DEFAULT_BATCH_LIMIT
  }

  /**
   * Removes unsaved Feed Items aged past retention or orphaned by unsubscribe, then
   * unreferenced unsubscribed Feeds — a Feed with saves keeps its row, the
   * attribution the Library shows.
   */
  sweep(): void {
    const cutoff = new Date(this.#clock.now().getTime() - RETENTION_PERIOD_MS).toISOString()

    const { prunedItems, retiredFeeds } = this.#db.transaction((tx) => {
      const unsaved = isNull(libraryItems.feedItemId)
      const aged = tx
        .select({ id: feedItems.id })
        .from(feedItems)
        .leftJoin(libraryItems, eq(libraryItems.feedItemId, feedItems.id))
        .where(and(unsaved, lte(feedItems.lastObservedAt, cutoff)))
        .limit(this.#batchLimit)
        .all()

      const orphaned = tx
        .select({ id: feedItems.id })
        .from(feedItems)
        .leftJoin(libraryItems, eq(libraryItems.feedItemId, feedItems.id))
        .leftJoin(subscriptions, eq(subscriptions.feedId, feedItems.feedId))
        .where(and(unsaved, isNull(subscriptions.feedId)))
        .limit(this.#batchLimit)
        .all()

      const doomed = [...new Set([...aged, ...orphaned].map((row) => row.id))]
      if (doomed.length > 0) tx.delete(feedItems).where(inArray(feedItems.id, doomed)).run()

      // Deleting a Feed cascades into its Feed Items, so only a Feed with no
      // Subscription and no retained item may go.
      const dormant = tx
        .select({ id: feeds.id })
        .from(feeds)
        .leftJoin(subscriptions, eq(subscriptions.feedId, feeds.id))
        .leftJoin(feedItems, eq(feedItems.feedId, feeds.id))
        .where(and(isNull(subscriptions.feedId), isNull(feedItems.id)))
        .limit(this.#batchLimit)
        .all()
      if (dormant.length > 0) {
        tx.delete(feeds)
          .where(
            inArray(
              feeds.id,
              dormant.map((row) => row.id),
            ),
          )
          .run()
      }

      return { prunedItems: doomed.length, retiredFeeds: dormant.length }
    })

    if (prunedItems > 0 || retiredFeeds > 0) {
      this.#logger.info('retention.sweep_completed', { prunedItems, retiredFeeds })
    }
  }
}
