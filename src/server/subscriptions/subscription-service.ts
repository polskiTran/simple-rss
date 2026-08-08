import { eq, type ExtractTablesWithRelations } from 'drizzle-orm'
import {
  drizzle,
  type BetterSQLite3Database,
  type BetterSQLiteTransaction,
} from 'drizzle-orm/better-sqlite3'
import type { SubscriptionSummary } from '../../shared/api.js'
import type { Clock } from '../clock.js'
import { dateKey } from '../digest/digest-service.js'
import {
  FeedDocumentError,
  parseFeedDocument,
  type NormalizedFeedItem,
  type ParsedFeedDocument,
} from '../ingestion/feed-document.js'
import type { SqliteDatabase } from '../persistence/database.js'
import type { InstallationSettingsStore } from '../persistence/installation-settings.js'
import { feedItems, feeds, feedUrlAliases, subscriptions } from '../persistence/schema.js'
import type { Retrieval, RetrievalFailure } from '../upstream/retrieval.js'

type EmptySchema = Record<string, never>
type DatabaseTransaction = BetterSQLiteTransaction<EmptySchema, ExtractTablesWithRelations<EmptySchema>>

export type CreateSubscriptionOutcome =
  | { readonly kind: 'created'; readonly subscription: SubscriptionSummary; readonly importedItems: number }
  | { readonly kind: 'duplicate'; readonly subscription: SubscriptionSummary }
  | { readonly kind: 'invalid-url' }
  | { readonly kind: 'retrieval-failed'; readonly failure: RetrievalFailure }
  | { readonly kind: 'invalid-feed'; readonly code: FeedDocumentError['code'] }

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

export class SubscriptionService {
  readonly #db: BetterSQLite3Database
  readonly #retrieval: Retrieval
  readonly #clock: Clock
  readonly #settings: InstallationSettingsStore

  constructor(options: {
    database: SqliteDatabase
    retrieval: Retrieval
    clock: Clock
    settings: InstallationSettingsStore
  }) {
    this.#db = drizzle(options.database)
    this.#retrieval = options.retrieval
    this.#clock = options.clock
    this.#settings = options.settings
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

        for (const item of parsed.items) this.#upsertItem(tx, feedId, item, now)
        return { feedId, title: parsed.title, domain, enteredUrl, resolvedUrl: retrieved.url }
      })
    } catch (error) {
      const raced = this.#feedByCanonicalUrl(requestedUrl) ?? this.#feedByCanonicalUrl(retrieved.url)
      if (raced) return { kind: 'duplicate', subscription: this.#withCadence(raced) }
      throw error
    }

    return {
      kind: 'created',
      subscription: this.#withCadence(created),
      importedItems: new Set(parsed.items.map((item) => item.dedupeKey)).size,
    }
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

    this.#persistWindow(feedId, parsed, retrieved.url, this.#clock.now().toISOString())
    return { kind: 'updated', observedItems: new Set(parsed.items.map((item) => item.dedupeKey)).size }
  }


  #persistWindow(feedId: number, parsed: ParsedFeedDocument, resolvedUrl: string, now: string): void {
    const domain = new URL(resolvedUrl).hostname
    this.#db.transaction((tx) => {
      const alias = tx
        .select({ feedId: feedUrlAliases.feedId })
        .from(feedUrlAliases)
        .where(eq(feedUrlAliases.url, resolvedUrl))
        .limit(1)
        .all()[0]
      if (alias && alias.feedId !== feedId) throw new Error('Resolved Feed URL belongs to another Feed')

      tx.insert(feedUrlAliases).values({ url: resolvedUrl, feedId }).onConflictDoNothing().run()
      tx.update(feeds)
        .set({ title: parsed.title, domain, resolvedUrl, updatedAt: now })
        .where(eq(feeds.id, feedId))
        .run()
      for (const item of parsed.items) this.#upsertItem(tx, feedId, item, now)
    })
  }

  list(): readonly SubscriptionSummary[] {
    const records = this.#db
      .select({
        feedId: feeds.id,
        title: feeds.title,
        domain: feeds.domain,
        enteredUrl: feeds.enteredUrl,
        resolvedUrl: feeds.resolvedUrl,
      })
      .from(feeds)
      .innerJoin(subscriptions, eq(subscriptions.feedId, feeds.id))
      .orderBy(feeds.title)
      .all()
    const cadence = this.#cadenceByFeed()
    return records.map((record) => ({ ...record, cadence: cadence.get(record.feedId) ?? emptyCadence() }))
  }

  #withCadence(feed: FeedRecord): SubscriptionSummary {
    return { ...feed, cadence: this.#cadenceByFeed().get(feed.feedId) ?? emptyCadence() }
  }

  #feedByCanonicalUrl(url: string): FeedRecord | undefined {
    return this.#db
      .select({
        feedId: feeds.id,
        title: feeds.title,
        domain: feeds.domain,
        enteredUrl: feeds.enteredUrl,
        resolvedUrl: feeds.resolvedUrl,
      })
      .from(feedUrlAliases)
      .innerJoin(feeds, eq(feeds.id, feedUrlAliases.feedId))
      .innerJoin(subscriptions, eq(subscriptions.feedId, feeds.id))
      .where(eq(feedUrlAliases.url, url))
      .limit(1)
      .all()[0]
  }

  #feedById(feedId: number): FeedRecord | undefined {
    return this.#db
      .select({
        feedId: feeds.id,
        title: feeds.title,
        domain: feeds.domain,
        enteredUrl: feeds.enteredUrl,
        resolvedUrl: feeds.resolvedUrl,
      })
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
    const futureLimit = now.getTime() + 24 * 60 * 60 * 1_000
    const rows = this.#db
      .select({ feedId: feedItems.feedId, publishedAt: feedItems.publishedAt, firstSeenAt: feedItems.firstSeenAt })
      .from(feedItems)
      .all()
    for (const row of rows) {
      const published = row.publishedAt ? Date.parse(row.publishedAt) : Number.NaN
      const time = Number.isFinite(published) && published <= futureLimit ? published : Date.parse(row.firstSeenAt)
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

  #upsertItem(tx: DatabaseTransaction, feedId: number, item: NormalizedFeedItem, now: string): void {
    tx.insert(feedItems)
      .values({
        feedId,
        dedupeKey: item.dedupeKey,
        identityKind: item.identityKind,
        title: item.title,
        link: item.link,
        publishedAt: item.publishedAt,
        imageUrl: item.imageUrl,
        summary: item.summary,
        firstSeenAt: now,
        lastObservedAt: now,
      })
      .onConflictDoUpdate({
        target: [feedItems.feedId, feedItems.dedupeKey],
        set: {
          title: item.title,
          link: item.link,
          publishedAt: item.publishedAt,
          imageUrl: item.imageUrl,
          summary: item.summary,
          lastObservedAt: now,
        },
      })
      .run()
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

function emptyCadence(): number[] {
  return Array.from({ length: 30 }, () => 0)
}
