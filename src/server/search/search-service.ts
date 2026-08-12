import type { SearchResults } from '../../shared/api.js'
import type { Clock } from '../clock.js'
import { dateKey, inDigestOrder, metaRowDate, plausibleHorizon } from '../digest/chronology.js'
import type { SqliteDatabase } from '../persistence/database.js'
import type { InstallationSettingsStore } from '../persistence/installation-settings.js'

// A query drowning in matches wants another word, not a longer page; the bound
// keeps the query cheap at the ~100-Subscription target.
export const SEARCH_RESULT_LIMIT = 50

interface MatchRow {
  feedItemId: number
  title: string | null
  publishedAt: string | null
  firstSeenAt: string
  feedId: number
  feedTitle: string
  savedAt: string | null
  subscribedFeedId: number | null
}

/**
 * Answered from the `feed_item_search` FTS index the migration's triggers keep current.
 * Coverage is what the reader still shows; an unsubscribed Feed's unsaved items are
 * excluded immediately — a derived index must not resurrect what the User let go of.
 */
export class SearchService {
  readonly #db: SqliteDatabase
  readonly #clock: Clock
  readonly #settings: InstallationSettingsStore

  constructor(options: { database: SqliteDatabase; clock: Clock; settings: InstallationSettingsStore }) {
    this.#db = options.database
    this.#clock = options.clock
    this.#settings = options.settings
  }

  search(query: string): SearchResults {
    const match = matchExpressionOf(query)
    if (!match) return { results: [] }

    const timezone = this.#settings.effectiveTimezone()
    const now = this.#clock.now()
    const today = dateKey(now, timezone)

    // The FTS table decides what matches; the joins decide what may be shown. The LIMIT
    // applies under the same chronology rule the rows are displayed in, so a
    // future-dated item cannot hold a bound slot it will not rank at.
    const rows = this.#db
      .prepare(
        `SELECT
           feed_items.id            AS feedItemId,
           feed_items.title         AS title,
           feed_items.published_at  AS publishedAt,
           feed_items.first_seen_at AS firstSeenAt,
           feeds.id                 AS feedId,
           feeds.title              AS feedTitle,
           library_items.saved_at   AS savedAt,
           subscriptions.feed_id    AS subscribedFeedId
         FROM feed_item_search
         JOIN feed_items ON feed_items.id = feed_item_search.rowid
         JOIN feeds ON feeds.id = feed_items.feed_id
         LEFT JOIN library_items ON library_items.feed_item_id = feed_items.id
         LEFT JOIN subscriptions ON subscriptions.feed_id = feeds.id
         WHERE feed_item_search MATCH ?
           AND (subscriptions.feed_id IS NOT NULL OR library_items.feed_item_id IS NOT NULL)
         ORDER BY
           CASE
             WHEN feed_items.published_at IS NOT NULL AND feed_items.published_at <= ?
             THEN feed_items.published_at
             ELSE feed_items.first_seen_at
           END DESC,
           feed_items.id DESC
         LIMIT ?`,
      )
      .all(match, plausibleHorizon(now), SEARCH_RESULT_LIMIT) as MatchRow[]

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
 * Rebuilds the derived index from the canonical tables — the recovery the FTS design
 * promises. Run through the CLI; the triggers keep it current from then on.
 */
export function rebuildSearchIndex(db: SqliteDatabase): number {
  return db.transaction(() => {
    db.exec('DELETE FROM feed_item_search')
    return db
      .prepare(
        `INSERT INTO feed_item_search (rowid, item_title, summary, feed_title)
         SELECT feed_items.id, feed_items.title, feed_items.summary, feeds.title
         FROM feed_items JOIN feeds ON feeds.id = feed_items.feed_id`,
      )
      .run().changes
  })()
}
