import { and, desc, eq, isNotNull, or, type SQL, sql } from 'drizzle-orm'
import {
  type MarkedText,
  type MatchRange,
  SEARCH_RESULT_LIMIT,
  SEARCH_SUBSCRIPTION_LIMIT,
  UNTITLED_FEED_ITEM_TITLE,
  type SearchResult,
  type SearchResults,
  type SearchScope,
  type SearchSort,
  type SearchSubscriptionMatch,
} from '../../shared/api.js'
import type { Clock } from '../clock.js'
import { dateKey, dayKeysIn } from '../calendar.js'
import type { DrizzleDatabase } from '../persistence/database.js'
import { displayTimeOf } from '../persistence/feed-item-chronology.js'
import type { InstallationSettingsStore } from '../persistence/installation-settings.js'
import { LISTED_ITEM_COLUMNS, listedItemOf } from '../persistence/listed-item.js'
import { effectiveFeedTitle, feedItems, feeds, libraryItems, subscriptions } from '../persistence/schema.js'
import { stripCadenceByFeed } from '../digest/cadence-window.js'
import { feedItemSearch, SEARCHED_COLUMNS, type SearchedColumn } from './search-schema.js'

type ColumnWeights = Readonly<Record<SearchedColumn, number>>

const MATCH_WEIGHTS = { item_title: 4, summary: 1, feed_title: 2 } satisfies ColumnWeights
const SUMMARY_ALONE = { item_title: 0, summary: 1, feed_title: 0 } satisfies ColumnWeights
const RECENCY_DECAY_DAYS = 30

const TITLE_COLUMN = SEARCHED_COLUMNS.indexOf('item_title')
const SNIPPET_COLUMN = SEARCHED_COLUMNS.indexOf('summary')
const SNIPPET_TOKENS = 20
const SNIPPET_ELLIPSIS = '…'

const MATCH_OPENS = '\uE000'
const MATCH_CLOSES = '\uE001'

export class SearchService {
  readonly #db: DrizzleDatabase
  readonly #clock: Clock
  readonly #settings: InstallationSettingsStore

  constructor(options: { db: DrizzleDatabase; clock: Clock; settings: InstallationSettingsStore }) {
    this.#db = options.db
    this.#clock = options.clock
    this.#settings = options.settings
  }

  search(query: string, scope: SearchScope, sort: SearchSort): SearchResults | undefined {
    const words = wordsOf(query)
    const timezone = this.#settings.effectiveTimezone()
    const now = this.#clock.now()
    const today = dateKey(now, timezone)

    switch (scope.kind) {
      case 'everywhere':
        return {
          scope: 'everywhere',
          today,
          subscriptions: this.#withCadence(
            this.#matchingSubscriptions(words).slice(0, SEARCH_SUBSCRIPTION_LIMIT),
            timezone,
            now,
          ),
          results: this.#itemMatches(words, scope, sort, timezone, now),
        }
      case 'saved':
        return { scope: 'saved', today, results: this.#itemMatches(words, scope, sort, timezone, now) }
      case 'subscriptions':
        return {
          scope: 'subscriptions',
          today,
          subscriptions: this.#withCadence(this.#matchingSubscriptions(words), timezone, now),
        }
      case 'feed': {
        const title = this.#subscribedTitleOf(scope.feedId)
        if (title === undefined) return undefined
        return {
          scope: 'feed',
          today,
          feed: { title },
          results: this.#itemMatches(words, scope, sort, timezone, now),
        }
      }
    }
  }

  #subscribedTitleOf(feedId: number): string | undefined {
    return this.#db
      .select({ title: effectiveFeedTitle })
      .from(feeds)
      .innerJoin(subscriptions, eq(subscriptions.feedId, feeds.id))
      .where(eq(feeds.id, feedId))
      .get()?.title
  }

  #itemMatches(
    words: readonly string[],
    scope: Extract<SearchScope, { kind: 'everywhere' | 'saved' | 'feed' }>,
    sort: SearchSort,
    timezone: string,
    now: Date,
  ): SearchResult[] {
    if (words.length === 0) return []
    const match = matchExpressionOf(words)

    const chronology = feedItems.chronologyAt
    const relevance = sql`${bm25(MATCH_WEIGHTS)}
      / (1.0 + max(julianday(${now.toISOString()}) - julianday(${chronology}), 0) / ${RECENCY_DECAY_DAYS})`

    const rows = this.#db
      .select({
        ...LISTED_ITEM_COLUMNS,
        feedId: feeds.id,
        feedTitle: effectiveFeedTitle,
        markedTitle: sql<string | null>`highlight(${feedItemSearch}, ${TITLE_COLUMN}, ${MATCH_OPENS}, ${MATCH_CLOSES})`,
        summarySnippet: sql<
          string | null
        >`snippet(${feedItemSearch}, ${SNIPPET_COLUMN}, '', '', ${SNIPPET_ELLIPSIS}, ${SNIPPET_TOKENS})`,
        markedSummarySnippet: sql<
          string | null
        >`snippet(${feedItemSearch}, ${SNIPPET_COLUMN}, ${MATCH_OPENS}, ${MATCH_CLOSES}, ${SNIPPET_ELLIPSIS}, ${SNIPPET_TOKENS})`,
        summaryMatchQuality: bm25(SUMMARY_ALONE),
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
          scope.kind === 'saved' ? isNotNull(libraryItems.feedItemId) : undefined,
          scope.kind === 'feed' ? eq(feedItems.feedId, scope.feedId) : undefined,
        ),
      )
      .orderBy(...(sort === 'best' ? [relevance] : []), desc(chronology), desc(feedItems.id))
      .limit(SEARCH_RESULT_LIMIT)
      .all()

    const dayOf = dayKeysIn(timezone)
    return rows.map((row) => ({
      ...listedItemOf(row),
      title: markedTextOf(row.markedTitle, row.title ?? UNTITLED_FEED_ITEM_TITLE),
      feedId: row.feedId,
      feedTitle: row.feedTitle,
      date: dayOf(row.chronologyAt),
      displayTime: displayTimeOf(row, timezone),
      snippet:
        row.summaryMatchQuality < 0 && row.summarySnippet !== null
          ? markedTextOf(row.markedSummarySnippet, row.summarySnippet)
          : null,
    }))
  }

  #matchingSubscriptions(words: readonly string[]): Omit<SearchSubscriptionMatch, 'cadence'>[] {
    if (words.length === 0) return []
    const needles = words.map(folded)
    return this.#db
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
  }

  #withCadence(
    matches: readonly Omit<SearchSubscriptionMatch, 'cadence'>[],
    timezone: string,
    now: Date,
  ): SearchSubscriptionMatch[] {
    const cadenceOf = stripCadenceByFeed(
      this.#db,
      timezone,
      now,
      matches.map((row) => row.feedId),
    )
    return matches.map((row) => ({ ...row, cadence: cadenceOf(row.feedId) }))
  }
}

function folded(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
}

function bm25(weights: ColumnWeights): SQL<number> {
  const ordered = SEARCHED_COLUMNS.map((column) => sql`${weights[column]}`)
  return sql<number>`bm25(${feedItemSearch}, ${sql.join(ordered, sql`, `)})`
}

function markedTextOf(marked: string | null, text: string): MarkedText {
  const matches: MatchRange[] = []
  let unmarked = ''
  let start = 0
  for (const character of marked ?? '') {
    if (character === MATCH_OPENS) start = unmarked.length
    else if (character === MATCH_CLOSES) matches.push([start, unmarked.length])
    else unmarked += character
  }
  return { text, matches: unmarked === text ? matches : [] }
}

function wordsOf(query: string): string[] {
  return query
    .split(/\s+/)
    .map((word) => word.replaceAll('"', ''))
    .filter((word) => /[\p{L}\p{N}]/u.test(word))
}

function matchExpressionOf(words: readonly string[]): string {
  return words.map((word, index) => (index === words.length - 1 ? `"${word}"*` : `"${word}"`)).join(' ')
}

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
          .innerJoin(feeds, eq(feeds.id, feedItems.feedId)),
      )
      .run().changes
  })
}
