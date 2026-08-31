import { and, desc, eq, isNotNull, or, sql } from 'drizzle-orm'
import type { SearchResults } from '../../shared/api.js'
import type { Clock } from '../clock.js'
import { chronologyTime, dateKey, metaRowDate } from '../digest/chronology.js'
import { chronologySql } from '../digest/list-page.js'
import type { DrizzleDatabase } from '../persistence/database.js'
import type { InstallationSettingsStore } from '../persistence/installation-settings.js'
import { effectiveFeedTitle, feedItems, feeds, libraryItems, subscriptions } from '../persistence/schema.js'
import { feedItemSearch } from './search-schema.js'

export const SEARCH_RESULT_LIMIT = 50

// Tuning constants for ADR 0009's ranking, not contract: harness tests pin
// relative order only. BM25 weights follow the FTS5 column order — a Feed
// Item's own title speaks loudest, the effective Feed title next, the summary
// last. The half-life is how many days of age cost a match half its pull.
const ITEM_TITLE_WEIGHT = 4
const SUMMARY_WEIGHT = 1
const FEED_TITLE_WEIGHT = 2
const RECENCY_HALF_LIFE_DAYS = 30

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

    // ADR 0009: BM25 match quality blended with recency decay, stated in SQL so
    // the LIMIT bounds the right fifty. bm25() is more negative the better the
    // match; dividing by the age factor shrinks it toward zero as the item ages
    // — halved at the half-life — so a strong old title match outlasts a weak
    // fresh summary match while comparable matches yield to the recent one.
    const chronology = chronologySql(now)
    const relevance = sql`bm25(${feedItemSearch}, ${ITEM_TITLE_WEIGHT}, ${SUMMARY_WEIGHT}, ${FEED_TITLE_WEIGHT})
      / (1.0 + max(julianday(${now.toISOString()}) - julianday(${chronology}), 0) / ${RECENCY_HALF_LIFE_DAYS})`

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
      .orderBy(relevance, sql`${chronology} DESC`, desc(feedItems.id))
      .limit(SEARCH_RESULT_LIMIT)
      .all()

    // Rows keep the SQL relevance order; chronology here only feeds the display date.
    const results = rows.map((row) => {
      const instant = new Date(chronologyTime(row.publishedAt, row.firstSeenAt, now))
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

/** Rebuilds the derived FTS5 index from its canonical tables. */
export function rebuildSearchIndex(db: DrizzleDatabase): number {
  return db.transaction((tx) => {
    tx.delete(feedItemSearch).run()
    return tx
      .insert(feedItemSearch)
      .select(
        tx
          .select({
            rowid: feedItems.id,
            itemTitle: feedItems.title,
            summary: feedItems.summary,
            feedTitle: effectiveFeedTitle.as('feed_title'),
          })
          .from(feedItems)
          .innerJoin(feeds, eq(feeds.id, feedItems.feedId))
          .leftJoin(subscriptions, eq(subscriptions.feedId, feeds.id)),
      )
      .run().changes
  })
}
