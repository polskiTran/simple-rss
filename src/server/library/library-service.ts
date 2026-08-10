import { desc, eq, sql } from 'drizzle-orm'
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import type { Library, LibraryItem, LibraryMembership } from '../../shared/api.js'
import type { Clock } from '../clock.js'
import { dateKey, inDigestOrder, metaRowDate } from '../digest/chronology.js'
import {
  beyondCursorSql,
  chronologySql,
  LIST_PAGE_SIZE,
  nextListCursor,
  type ListCursor,
} from '../digest/list-page.js'
import type { SqliteDatabase } from '../persistence/database.js'
import type { InstallationSettingsStore } from '../persistence/installation-settings.js'
import { feedItems, feeds, libraryItems, subscriptions } from '../persistence/schema.js'

/**
 * The User's explicitly saved Feed Items. Membership is its own table, so a
 * save is untouched by ingestion's metadata corrections and, later, survives
 * retention pruning and unsubscribing.
 */
export class LibraryService {
  readonly #db: BetterSQLite3Database
  readonly #clock: Clock
  readonly #settings: InstallationSettingsStore

  constructor(options: { database: SqliteDatabase; clock: Clock; settings: InstallationSettingsStore }) {
    this.#db = drizzle(options.database)
    this.#clock = options.clock
    this.#settings = options.settings
  }

  /**
   * Saves one Feed Item, idempotently: a repeated save answers with the
   * membership that already exists rather than moving its saved time.
   * `undefined` means there is no such Feed Item to save.
   */
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

  /**
   * Removes one Feed Item from the Library. Unsaving the already-unsaved —
   * or the already-pruned — simply confirms the state the User asked for.
   */
  unsave(feedItemId: number): LibraryMembership {
    this.#db.delete(libraryItems).where(eq(libraryItems.feedItemId, feedItemId)).run()
    return { feedItemId, saved: false, savedAt: null }
  }

  /**
   * One page of the Library, in the same chronology — and on the same cursor
   * — the Digest orders by.
   */
  list(cursor?: ListCursor): Library {
    const timezone = this.#settings.effectiveTimezone()
    const now = this.#clock.now()
    const today = dateKey(now, timezone)
    const chronology = chronologySql(now)

    // One row past the page says whether a next page exists at all.
    const fetched = this.#db
      .select({
        feedItemId: feedItems.id,
        title: feedItems.title,
        feedId: feeds.id,
        feedTitle: feeds.title,
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
      .where(cursor ? beyondCursorSql(chronology, cursor) : undefined)
      .orderBy(sql`${chronology} DESC`, desc(feedItems.id))
      .limit(LIST_PAGE_SIZE + 1)
      .all()

    const rows = inDigestOrder(fetched.slice(0, LIST_PAGE_SIZE), now)

    const items: LibraryItem[] = rows.map(({ row, chronology }) => {
      const instant = new Date(chronology)
      return {
        feedItemId: row.feedItemId,
        title: row.title ?? 'untitled',
        feedId: row.feedId,
        feedTitle: row.feedTitle,
        // A save outlives its Subscription; the view says so instead of
        // leaving the User to wonder whether the reader forgot.
        subscribed: row.subscribedFeedId !== null,
        link: row.link,
        publishedAt: row.publishedAt,
        firstSeenAt: row.firstSeenAt,
        savedAt: row.savedAt,
        displayDate: metaRowDate(instant, dateKey(instant, timezone), today, timezone),
      }
    })

    return { items, nextCursor: nextListCursor(fetched.length, rows.at(-1)) }
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
