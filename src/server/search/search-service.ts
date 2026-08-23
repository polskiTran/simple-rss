import { and, desc, eq, isNotNull, or, sql } from 'drizzle-orm'
import type { SearchResults } from '../../shared/api.js'
import type { Clock } from '../clock.js'
import { dateKey, inDigestOrder, metaRowDate } from '../digest/chronology.js'
import { chronologySql } from '../digest/list-page.js'
import type { DrizzleDatabase } from '../persistence/database.js'
import type { InstallationSettingsStore } from '../persistence/installation-settings.js'
import { effectiveFeedTitle, feedItems, feeds, libraryItems, subscriptions } from '../persistence/schema.js'
import { feedItemSearch } from './search-schema.js'

export const SEARCH_RESULT_LIMIT = 50

export class SearchService {
  readonly #db: DrizzleDatabase
  readonly #clock: Clock
  readonly #settings: InstallationSettingsStore

  constructor(options: { db: DrizzleDatabase; clock: Clock; settings: InstallationSettingsStore }) {
    this.#db = options.db
    this.#clock = options.clock
    this.#settings = options.settings
  }

  search(query: string): SearchResults {
    const match = matchExpressionOf(query)
    if (!match) return { results: [] }

    const timezone = this.#settings.effectiveTimezone()
    const now = this.#clock.now()
    const today = dateKey(now, timezone)

    const rows = this.#db
      .select({
        feedItemId: feedItems.id,
        title: feedItems.title,
        publishedAt: feedItems.publishedAt,
        firstSeenAt: feedItems.firstSeenAt,
        feedId: feeds.id,
        feedTitle: effectiveFeedTitle,
        savedAt: libraryItems.savedAt,
      })
      .from(feedItemSearch)
      .innerJoin(feedItems, eq(feedItems.id, feedItemSearch.rowid))
      .innerJoin(feeds, eq(feeds.id, feedItems.feedId))
      .leftJoin(libraryItems, eq(libraryItems.feedItemId, feedItems.id))
      .leftJoin(subscriptions, eq(subscriptions.feedId, feeds.id))
      .where(
        and(
          sql`${feedItemSearch} MATCH ${match}`,
          or(isNotNull(subscriptions.feedId), isNotNull(libraryItems.feedItemId)),
        ),
      )
      .orderBy(sql`${chronologySql(now)} DESC`, desc(feedItems.id))
      .limit(SEARCH_RESULT_LIMIT)
      .all()

    const results = inDigestOrder(rows, now).map(({ row, chronology }) => {
      const instant = new Date(chronology)
      return {
        feedItemId: row.feedItemId,
        title: row.title ?? 'untitled',
        feedId: row.feedId,
        feedTitle: row.feedTitle,
        publishedAt: row.publishedAt,
        firstSeenAt: row.firstSeenAt,
        displayDate: metaRowDate(instant, dateKey(instant, timezone), today, timezone),
        saved: row.savedAt !== null,
      }
    })

    return { results }
  }
}

/**
 * Every word becomes a quoted phrase — all must match, the last as a prefix for
 * search-as-you-type. FTS5 operators are deliberately not offered: a search line
 * is words, not syntax. `undefined` when nothing tokenizable remains.
 */
function matchExpressionOf(query: string): string | undefined {
  const words = query
    .split(/\s+/)
    .map((word) => word.replaceAll('"', ''))
    // A word with no letter or digit tokenizes to nothing; quoting it would hand FTS5 an empty phrase.
    .filter((word) => /[\p{L}\p{N}]/u.test(word))
  if (words.length === 0) return undefined

  return words.map((word, index) => (index === words.length - 1 ? `"${word}"*` : `"${word}"`)).join(' ')
}

/**
 * Restates `effectiveFeedTitle` (persistence/schema.ts) in SQL; keep them in
 * step. FTS5 is outside the schema mirror, but the operation still uses the
 * process-wide Drizzle handle.
 */
export function rebuildSearchIndex(db: DrizzleDatabase): number {
  return db.transaction((tx) => {
    tx.run(sql`DELETE FROM feed_item_search`)
    return tx.run(sql`
      INSERT INTO feed_item_search (rowid, item_title, summary, feed_title)
      SELECT feed_items.id, feed_items.title, feed_items.summary,
             coalesce(subscriptions.custom_title, feeds.title)
      FROM feed_items
      JOIN feeds ON feeds.id = feed_items.feed_id
      LEFT JOIN subscriptions ON subscriptions.feed_id = feeds.id
    `).changes
  })
}
