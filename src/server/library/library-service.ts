import { asc, count, desc, eq } from 'drizzle-orm'
import type { Library, LibraryItem, LibraryMembership, LibraryOrder } from '../../shared/api.js'
import type { Clock } from '../clock.js'
import { dateKey } from '../digest/chronology.js'
import { beyondCursorSql, encodeListCursor, LIST_PAGE_SIZE, type ListCursor } from '../digest/list-page.js'
import type { DrizzleDatabase } from '../persistence/database.js'
import type { InstallationSettingsStore } from '../persistence/installation-settings.js'
import { effectiveFeedTitle, feedItems, feeds, libraryItems, subscriptions } from '../persistence/schema.js'

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
   * Keyset pages over the saved time, ties by id (ADR 0006).
   */
  list(order: LibraryOrder, cursor?: ListCursor): Library {
    const timezone = this.#settings.effectiveTimezone()
    const now = this.#clock.now()
    const direction = order === 'oldest' ? asc : desc

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
      .where(cursor ? beyondCursorSql(libraryItems.savedAt, cursor, order) : undefined)
      .orderBy(direction(libraryItems.savedAt), direction(feedItems.id))
      .limit(LIST_PAGE_SIZE + 1)
      .all()

    const rows = fetched.slice(0, LIST_PAGE_SIZE)
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
        fetched.length > LIST_PAGE_SIZE && last
          ? encodeListCursor({ instant: last.savedAt, feedItemId: last.feedItemId })
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
