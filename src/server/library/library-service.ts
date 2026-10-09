import { and, asc, count, desc, eq, gt, lt, or } from 'drizzle-orm'
import type { Library, LibraryItem, LibraryMembership, LibraryOrder } from '../../shared/api.js'
import type { Clock } from '../clock.js'
import { dateKey } from '../calendar.js'
import type { DrizzleDatabase } from '../persistence/database.js'
import type { InstallationSettingsStore } from '../persistence/installation-settings.js'
import { effectiveFeedTitle, feedItems, feeds, libraryItems, subscriptions } from '../persistence/schema.js'
import { encodeLibraryCursor, type LibraryCursor } from './library-cursor.js'

const LIBRARY_PAGE_SIZE = 50

export class LibraryService {
  readonly #db: DrizzleDatabase
  readonly #clock: Clock
  readonly #settings: InstallationSettingsStore

  constructor(options: { db: DrizzleDatabase; clock: Clock; settings: InstallationSettingsStore }) {
    this.#db = options.db
    this.#clock = options.clock
    this.#settings = options.settings
  }

  /** Idempotent: a repeated save keeps the existing saved time. `undefined` when no such Feed Item exists. */
  save(feedItemId: number): LibraryMembership | undefined {
    const exists = this.#db
      .select({ id: feedItems.id })
      .from(feedItems)
      .where(eq(feedItems.id, feedItemId))
      .limit(1)
      .all()[0]
    if (!exists) return undefined

    this.#db
      .insert(libraryItems)
      .values({ feedItemId, savedAt: this.#clock.now().toISOString() })
      .onConflictDoNothing()
      .run()
    return this.#membership(feedItemId)
  }

  /** Unsaving the already-unsaved — or already-pruned — simply confirms the requested state. */
  unsave(feedItemId: number): LibraryMembership {
    this.#db.delete(libraryItems).where(eq(libraryItems.feedItemId, feedItemId)).run()
    return { feedItemId, saved: false, savedAt: null }
  }

  /**
   * The Library by when each item was saved: newest save first, or oldest.
   * Keyset pages over the saved time, ties by id (ADR 0011).
   */
  list(order: LibraryOrder, cursor?: LibraryCursor): Library {
    const timezone = this.#settings.effectiveTimezone()
    const now = this.#clock.now()
    const direction = order === 'oldest' ? asc : desc
    // Strictly beyond the cursor in the page's own direction, ties broken by id the same way.
    const beyond = order === 'oldest' ? gt : lt

    const fetched = this.#db
      .select({
        feedItemId: feedItems.id,
        title: feedItems.title,
        feedId: feeds.id,
        feedTitle: effectiveFeedTitle,
        link: feedItems.link,
        publishedAt: feedItems.publishedAt,
        firstSeenAt: feedItems.firstSeenAt,
        savedAt: libraryItems.savedAt,
        subscribedFeedId: subscriptions.feedId,
      })
      .from(libraryItems)
      .innerJoin(feedItems, eq(feedItems.id, libraryItems.feedItemId))
      .innerJoin(feeds, eq(feeds.id, feedItems.feedId))
      .leftJoin(subscriptions, eq(subscriptions.feedId, feeds.id))
      .where(
        cursor &&
          or(
            beyond(libraryItems.savedAt, cursor.savedAt),
            and(eq(libraryItems.savedAt, cursor.savedAt), beyond(feedItems.id, cursor.feedItemId)),
          ),
      )
      .orderBy(direction(libraryItems.savedAt), direction(feedItems.id))
      .limit(LIBRARY_PAGE_SIZE + 1)
      .all()

    const rows = fetched.slice(0, LIBRARY_PAGE_SIZE)
    const last = rows.at(-1)

    const items: LibraryItem[] = rows.map((row) => ({
      feedItemId: row.feedItemId,
      title: row.title ?? 'Untitled',
      feedId: row.feedId,
      feedTitle: row.feedTitle,
      subscribed: row.subscribedFeedId !== null,
      link: row.link,
      publishedAt: row.publishedAt,
      firstSeenAt: row.firstSeenAt,
      savedAt: row.savedAt,
      savedDate: dateKey(new Date(row.savedAt), timezone),
    }))

    return {
      today: dateKey(now, timezone),
      total: this.#db.select({ total: count() }).from(libraryItems).get()?.total ?? 0,
      items,
      nextCursor:
        fetched.length > LIBRARY_PAGE_SIZE && last
          ? encodeLibraryCursor({ savedAt: last.savedAt, feedItemId: last.feedItemId })
          : null,
    }
  }

  #membership(feedItemId: number): LibraryMembership {
    const row = this.#db
      .select({ savedAt: libraryItems.savedAt })
      .from(libraryItems)
      .where(eq(libraryItems.feedItemId, feedItemId))
      .limit(1)
      .all()[0]
    return row ? { feedItemId, saved: true, savedAt: row.savedAt } : { feedItemId, saved: false, savedAt: null }
  }
}
