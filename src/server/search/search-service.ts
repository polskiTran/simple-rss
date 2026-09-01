import { and, desc, eq, isNotNull, or, sql } from 'drizzle-orm'
import type { SearchResults, SearchSubscriptionMatch } from '../../shared/api.js'
import type { Clock } from '../clock.js'
import { chronologyTime, dateKey, metaRowDate } from '../digest/chronology.js'
import { chronologySql } from '../digest/list-page.js'
import type { DrizzleDatabase } from '../persistence/database.js'
import type { InstallationSettingsStore } from '../persistence/installation-settings.js'
import { effectiveFeedTitle, feedItems, feeds, libraryItems, subscriptions } from '../persistence/schema.js'
import { emptyCadence, stripCadenceByFeed } from '../subscriptions/cadence-window.js'
import { feedItemSearch } from './search-schema.js'

export const SEARCH_RESULT_LIMIT = 50
export const SEARCH_SUBSCRIPTION_LIMIT = 5

// BM25 weights are positional, following the FTS5 column order.
const ITEM_TITLE_WEIGHT = 4
const SUMMARY_WEIGHT = 1
const FEED_TITLE_WEIGHT = 2
const RECENCY_DECAY_DAYS = 30

// Snippets come from the summary column only — the title and Feed title are
// already visible in the item shape, so a fragment of either proves nothing.
// snippet() windows the column's opening tokens even when the match landed
// elsewhere, so a bm25 probe weighted to the summary alone answers "did the
// summary itself match": strictly negative means yes (FTS5 clamps idf above
// zero), exactly zero means the match lives entirely in the other columns.
const SNIPPET_COLUMN = 1
const SNIPPET_TOKENS = 20

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
    const words = wordsOf(query)
    if (words.length === 0) return { subscriptions: [], results: [] }
    const match = matchExpressionOf(words)

    const timezone = this.#settings.effectiveTimezone()
    const now = this.#clock.now()
    const today = dateKey(now, timezone)

    // ADR 0009: BM25 match quality blended with recency decay, stated in SQL so
    // the LIMIT bounds the right fifty. bm25() is more negative the better the
    // match; dividing by the age factor shrinks it toward zero as the item ages.
    const chronology = chronologySql(now)
    const relevance = sql`bm25(${feedItemSearch}, ${ITEM_TITLE_WEIGHT}, ${SUMMARY_WEIGHT}, ${FEED_TITLE_WEIGHT})
      / (1.0 + max(julianday(${now.toISOString()}) - julianday(${chronology}), 0) / ${RECENCY_DECAY_DAYS})`

    const rows = this.#db
      .select({
        feedItemId: feedItems.id,
        title: feedItems.title,
        publishedAt: feedItems.publishedAt,
        firstSeenAt: feedItems.firstSeenAt,
        feedId: feeds.id,
        feedTitle: effectiveFeedTitle,
        savedAt: libraryItems.savedAt,
        summarySnippet: sql<
          string | null
        >`snippet(${feedItemSearch}, ${SNIPPET_COLUMN}, '', '', '…', ${SNIPPET_TOKENS})`,
        summaryMatchQuality: sql<number>`bm25(${feedItemSearch}, 0, 1, 0)`,
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

    const results = rows.map((row) => {
      const displayInstant = new Date(chronologyTime(row.publishedAt, row.firstSeenAt, now))
      return {
        feedItemId: row.feedItemId,
        title: row.title ?? 'untitled',
        feedId: row.feedId,
        feedTitle: row.feedTitle,
        publishedAt: row.publishedAt,
        firstSeenAt: row.firstSeenAt,
        displayDate: metaRowDate(displayInstant, dateKey(displayInstant, timezone), today, timezone),
        saved: row.savedAt !== null,
        snippet: row.summaryMatchQuality < 0 ? row.summarySnippet : null,
      }
    })

    return { subscriptions: this.#subscriptionMatches(words, timezone, now), results }
  }

  #subscriptionMatches(words: readonly string[], timezone: string, now: Date): SearchSubscriptionMatch[] {
    const needles = words.map(folded)
    const matches = this.#db
      .select({
        feedId: feeds.id,
        title: effectiveFeedTitle,
        domain: feeds.domain,
        homePageUrl: feeds.homePageUrl,
      })
      .from(subscriptions)
      .innerJoin(feeds, eq(feeds.id, subscriptions.feedId))
      .orderBy(effectiveFeedTitle)
      .all()
      .filter((row) => {
        const line = folded(`${row.title} ${row.domain}`)
        return needles.every((needle) => line.includes(needle))
      })
      .slice(0, SEARCH_SUBSCRIPTION_LIMIT)
    if (matches.length === 0) return []

    const cadence = stripCadenceByFeed(
      this.#db,
      timezone,
      now,
      matches.map((row) => row.feedId),
    )
    return matches.map((row) => ({ ...row, cadence: cadence.get(row.feedId) ?? emptyCadence() }))
  }
}

/** Case- and diacritic-insensitive, matching the FTS tokenizer's temperament. */
function folded(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
}

/** The line as words: whitespace-split, quotes dropped, only tokenizable words kept. */
function wordsOf(query: string): string[] {
  return (
    query
      .split(/\s+/)
      .map((word) => word.replaceAll('"', ''))
      // A word with no letter or digit tokenizes to nothing; quoting it would hand FTS5 an empty phrase.
      .filter((word) => /[\p{L}\p{N}]/u.test(word))
  )
}

/**
 * Every word becomes a quoted phrase — all must match, the last as a prefix for
 * search-as-you-type. FTS5 operators are deliberately not offered: a search line
 * is words, not syntax.
 */
function matchExpressionOf(words: readonly string[]): string {
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
