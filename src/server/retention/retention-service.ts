import { and, eq, inArray, isNull, lte } from 'drizzle-orm'
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import type { Clock } from '../clock.js'
import type { Logger } from '../logger.js'
import type { SqliteDatabase } from '../persistence/database.js'
import { feedItems, feeds, libraryItems, subscriptions } from '../persistence/schema.js'

export const RETENTION_PERIOD_DAYS = 90

const RETENTION_PERIOD_MS = RETENTION_PERIOD_DAYS * 24 * 60 * 60 * 1_000

const DEFAULT_BATCH_LIMIT = 500

export interface RetentionLimits {
  readonly batchLimit?: number
}

export interface RetentionServiceOptions extends RetentionLimits {
  readonly database: SqliteDatabase
  readonly clock: Clock
  readonly logger: Logger
}

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
