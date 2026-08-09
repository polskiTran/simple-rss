import { eq } from 'drizzle-orm'
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import type { SubscriptionSummary } from '../../shared/api.js'
import type { Clock } from '../clock.js'
import { chronologyTime, dateKey } from '../digest/chronology.js'
import {
  FeedDocumentError,
  parseFeedDocument,
} from '../ingestion/feed-document.js'
import { persistFeedWindow, upsertFeedItem } from '../ingestion/feed-window.js'
import type { Logger } from '../logger.js'
import type { SqliteDatabase } from '../persistence/database.js'
import type { InstallationSettingsStore } from '../persistence/installation-settings.js'
import { feedItems, feeds, feedUrlAliases, subscriptions } from '../persistence/schema.js'
import type { Retrieval, RetrievalFailure } from '../upstream/retrieval.js'
import { OpmlError, parseOpml, serializeOpml, type OpmlFailureCode } from './opml.js'

export type CreateSubscriptionOutcome =
  | { readonly kind: 'created'; readonly subscription: SubscriptionSummary; readonly importedItems: number }
  | { readonly kind: 'duplicate'; readonly subscription: SubscriptionSummary }
  | { readonly kind: 'invalid-url' }
  | { readonly kind: 'retrieval-failed'; readonly failure: RetrievalFailure }
  | { readonly kind: 'invalid-feed'; readonly code: FeedDocumentError['code'] }

export type ImportOpmlOutcome =
  | { readonly kind: 'invalid-opml'; readonly code: OpmlFailureCode }
  | {
      readonly kind: 'report'
      readonly entries: readonly { readonly url: string; readonly outcome: CreateSubscriptionOutcome }[]
    }

export type IngestFeedOutcome =
  | { readonly kind: 'updated'; readonly observedItems: number }
  | { readonly kind: 'missing' }
  | { readonly kind: 'retrieval-failed'; readonly failure: RetrievalFailure }
  | { readonly kind: 'invalid-feed'; readonly code: FeedDocumentError['code'] }

interface FeedRecord {
  readonly feedId: number
  readonly title: string
  readonly domain: string
  readonly enteredUrl: string
  readonly resolvedUrl: string
}

/** The one shape every Feed lookup selects, mirrored by `FeedRecord`. */
const FEED_RECORD_COLUMNS = {
  feedId: feeds.id,
  title: feeds.title,
  domain: feeds.domain,
  enteredUrl: feeds.enteredUrl,
  resolvedUrl: feeds.resolvedUrl,
}

export class SubscriptionService {
  readonly #db: BetterSQLite3Database
  readonly #retrieval: Retrieval
  readonly #clock: Clock
  readonly #settings: InstallationSettingsStore
  readonly #logger: Logger

  constructor(options: {
    database: SqliteDatabase
    retrieval: Retrieval
    clock: Clock
    settings: InstallationSettingsStore
    logger: Logger
  }) {
    this.#db = drizzle(options.database)
    this.#retrieval = options.retrieval
    this.#clock = options.clock
    this.#settings = options.settings
    this.#logger = options.logger.child({ component: 'subscriptions' })
  }

  async create(enteredUrl: string): Promise<CreateSubscriptionOutcome> {
    const requestedUrl = canonicalFeedUrl(enteredUrl)
    if (!requestedUrl) return { kind: 'invalid-url' }

    const existing = this.#feedByCanonicalUrl(requestedUrl)
    if (existing) return { kind: 'duplicate', subscription: this.#withCadence(existing) }

    const retrieved = await this.#retrieval.retrieveBytes({ url: requestedUrl, operation: 'feed' })
    if (!retrieved.ok) return { kind: 'retrieval-failed', failure: retrieved }

    let parsed
    try {
      parsed = parseFeedDocument(retrieved.bytes, retrieved.url)
    } catch (error) {
      if (error instanceof FeedDocumentError) return { kind: 'invalid-feed', code: error.code }
      throw error
    }

    const duplicate = this.#feedByCanonicalUrl(retrieved.url)
    const now = this.#clock.now().toISOString()
    if (duplicate) return { kind: 'duplicate', subscription: this.#withCadence(duplicate) }

    const domain = new URL(retrieved.url).hostname
    let created: FeedRecord
    try {
      created = this.#db.transaction((tx) => {
        const inserted = tx
          .insert(feeds)
          .values({
            enteredUrl,
            resolvedUrl: retrieved.url,
            title: parsed.title,
            domain,
            createdAt: now,
            updatedAt: now,
          })
          .run()
        const feedId = Number(inserted.lastInsertRowid)

        const aliases = [...new Set([requestedUrl, retrieved.url])].map((url) => ({ url, feedId }))
        tx.insert(feedUrlAliases).values(aliases).run()
        tx.insert(subscriptions)
          .values({ feedId, pollingIntervalMinutes: 120, createdAt: now })
          .run()

        for (const item of parsed.items) upsertFeedItem(tx, feedId, item, now)
        return { feedId, title: parsed.title, domain, enteredUrl, resolvedUrl: retrieved.url }
      })
    } catch (error) {
      const raced = this.#feedByCanonicalUrl(requestedUrl) ?? this.#feedByCanonicalUrl(retrieved.url)
      if (raced) return { kind: 'duplicate', subscription: this.#withCadence(raced) }
      throw error
    }

    const importedItems = new Set(parsed.items.map((item) => item.dedupeKey)).size
    this.#logger.info('subscriptions.subscription_created', {
      feedId: created.feedId,
      enteredUrl: loggableUrl(enteredUrl),
      resolvedUrl: loggableUrl(retrieved.url),
      importedItems,
    })
    return { kind: 'created', subscription: this.#withCadence(created), importedItems }
  }

  /**
   * Moves another reader's OPML in through the normal Subscription creation
   * path, one Feed at a time, so one bad Feed fails alone and every rule that
   * guards `create` — validation, retrieval bounds, deduplication, the default
   * Polling Interval — holds for imports too.
   */
  async importOpml(opml: string): Promise<ImportOpmlOutcome> {
    let outlines
    try {
      outlines = parseOpml(opml)
    } catch (error) {
      if (error instanceof OpmlError) return { kind: 'invalid-opml', code: error.code }
      throw error
    }

    const entries: { url: string; outcome: CreateSubscriptionOutcome }[] = []
    for (const outline of outlines) {
      entries.push({ url: outline.url, outcome: await this.create(outline.url) })
    }

    const counted = (kind: CreateSubscriptionOutcome['kind']) =>
      entries.filter((entry) => entry.outcome.kind === kind).length
    this.#logger.info('subscriptions.opml_imported', {
      feeds: entries.length,
      added: counted('created'),
      skipped: counted('duplicate'),
      failed: entries.length - counted('created') - counted('duplicate'),
    })
    return { kind: 'report', entries }
  }

  /** The Owner's active Subscriptions as an OPML document another reader can import. */
  exportOpml(): string {
    return serializeOpml(this.#subscribedFeeds(), this.#clock.now())
  }

  async ingest(feedId: number): Promise<IngestFeedOutcome> {
    const feed = this.#feedById(feedId)
    if (!feed) return { kind: 'missing' }

    const retrieved = await this.#retrieval.retrieveBytes({ url: feed.resolvedUrl, operation: 'feed' })
    if (!retrieved.ok) return { kind: 'retrieval-failed', failure: retrieved }

    let parsed
    try {
      parsed = parseFeedDocument(retrieved.bytes, retrieved.url)
    } catch (error) {
      if (error instanceof FeedDocumentError) return { kind: 'invalid-feed', code: error.code }
      throw error
    }

    persistFeedWindow(this.#db, {
      feedId,
      parsed,
      resolvedUrl: retrieved.url,
      now: this.#clock.now().toISOString(),
    })
    const observedItems = new Set(parsed.items.map((item) => item.dedupeKey)).size
    this.#logger.info('subscriptions.feed_window_ingested', {
      feedId,
      enteredUrl: loggableUrl(feed.enteredUrl),
      resolvedUrl: loggableUrl(retrieved.url),
      observedItems,
    })
    return { kind: 'updated', observedItems }
  }

  list(): readonly SubscriptionSummary[] {
    const cadence = this.#cadenceByFeed()
    return this.#subscribedFeeds().map((record) => ({
      ...record,
      cadence: cadence.get(record.feedId) ?? emptyCadence(),
    }))
  }

  #subscribedFeeds(): readonly FeedRecord[] {
    return this.#db
      .select(FEED_RECORD_COLUMNS)
      .from(feeds)
      .innerJoin(subscriptions, eq(subscriptions.feedId, feeds.id))
      .orderBy(feeds.title)
      .all()
  }

  #withCadence(feed: FeedRecord): SubscriptionSummary {
    return { ...feed, cadence: this.#cadenceByFeed().get(feed.feedId) ?? emptyCadence() }
  }

  #feedByCanonicalUrl(url: string): FeedRecord | undefined {
    return this.#db
      .select(FEED_RECORD_COLUMNS)
      .from(feedUrlAliases)
      .innerJoin(feeds, eq(feeds.id, feedUrlAliases.feedId))
      .innerJoin(subscriptions, eq(subscriptions.feedId, feeds.id))
      .where(eq(feedUrlAliases.url, url))
      .limit(1)
      .all()[0]
  }

  #feedById(feedId: number): FeedRecord | undefined {
    return this.#db
      .select(FEED_RECORD_COLUMNS)
      .from(feeds)
      .innerJoin(subscriptions, eq(subscriptions.feedId, feeds.id))
      .where(eq(feeds.id, feedId))
      .limit(1)
      .all()[0]
  }

  #cadenceByFeed(): Map<number, number[]> {
    const timezone = this.#settings.read()?.timezone ?? 'UTC'
    const now = this.#clock.now()
    const today = dateKey(now, timezone)
    const indexByDate = new Map<string, number>()
    for (let index = 0; index < 30; index += 1) {
      const key = new Date(Date.parse(`${today}T00:00:00.000Z`) - (29 - index) * 24 * 60 * 60 * 1_000)
        .toISOString()
        .slice(0, 10)
      indexByDate.set(key, index)
    }

    const cadence = new Map<number, number[]>()
    const rows = this.#db
      .select({ feedId: feedItems.feedId, publishedAt: feedItems.publishedAt, firstSeenAt: feedItems.firstSeenAt })
      .from(feedItems)
      .all()
    for (const row of rows) {
      const time = chronologyTime(row.publishedAt, row.firstSeenAt, now)
      const index = indexByDate.get(dateKey(new Date(time), timezone))
      if (index === undefined) continue
      let counts = cadence.get(row.feedId)
      if (!counts) {
        counts = emptyCadence()
        cadence.set(row.feedId, counts)
      }
      counts[index] = (counts[index] ?? 0) + 1
    }
    return cadence
  }
}

function canonicalFeedUrl(value: string): string | undefined {
  try {
    const url = new URL(value)
    if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.username || url.password) return undefined
    url.hash = ''
    return url.href
  } catch {
    return undefined
  }
}

/** Diagnostics keep entered and resolved URLs apart, minus any query string. */
function loggableUrl(value: string): string {
  try {
    const url = new URL(value)
    return `${url.origin}${url.pathname}`
  } catch {
    return ''
  }
}

function emptyCadence(): number[] {
  return Array.from({ length: 30 }, () => 0)
}
