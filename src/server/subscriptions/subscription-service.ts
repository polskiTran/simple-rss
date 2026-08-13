import { and, eq, isNull, lte } from 'drizzle-orm'
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import {
  DEFAULT_POLLING_INTERVAL_MINUTES,
  FEED_UNAVAILABLE_AFTER_FAILURES,
  pollingIntervalMinutesSchema,
  type FeedAvailability,
  type FeedAvailabilityCategory,
  type FeedDetail,
  type FeedItemRow,
  type PollingIntervalMinutes,
  type PollingSchedule,
  type SubscriptionSummary,
} from '../../shared/api.js'
import type { Clock } from '../clock.js'
import { chronologyTime, dateKey, metaRowDate } from '../digest/chronology.js'
import {
  FeedDocumentError,
  parseFeedDocument,
  type ParsedFeedDocument,
} from '../ingestion/feed-document.js'
import { persistFeedWindow } from '../ingestion/feed-window.js'
import type { Logger } from '../logger.js'
import type { SqliteDatabase } from '../persistence/database.js'
import type { InstallationSettingsStore } from '../persistence/installation-settings.js'
import { feedItems, feeds, feedUrlAliases, libraryItems, subscriptions } from '../persistence/schema.js'
import type { Retrieval, RetrievalBytes, RetrievalFailure } from '../upstream/retrieval.js'
import { gridDayKeys, trailingDayKeys } from './cadence-window.js'
import { OpmlError, parseOpml, serializeOpml, type OpmlFailureCode } from './opml.js'
import { nextPollTime, nextRetryTime } from './polling-schedule.js'

export type CreateSubscriptionOutcome =
  | { readonly kind: 'created'; readonly subscription: SubscriptionSummary }
  | { readonly kind: 'duplicate'; readonly subscription: SubscriptionSummary }
  | { readonly kind: 'invalid-url' }

export type ImportOpmlOutcome =
  | { readonly kind: 'invalid-opml'; readonly code: OpmlFailureCode }
  | {
      readonly kind: 'report'
      readonly added: number
      readonly alreadySubscribed: number
      readonly unusable: readonly string[]
    }

export type IngestFeedOutcome =
  | { readonly kind: 'updated'; readonly observedItems: number }
  | { readonly kind: 'not-modified' }
  | { readonly kind: 'missing' }
  /** The retrieval revealed this Feed to be another subscribed Feed (ADR 0007). */
  | { readonly kind: 'merged'; readonly intoFeedId: number }
  | { readonly kind: 'retrieval-failed'; readonly failure: RetrievalFailure }
  | { readonly kind: 'invalid-feed'; readonly code: FeedDocumentError['code'] }

export type SetPollingIntervalOutcome =
  | { readonly kind: 'updated'; readonly schedule: PollingSchedule }
  | { readonly kind: 'missing' }

export type UnsubscribeOutcome = { readonly kind: 'unsubscribed' } | { readonly kind: 'missing' }

interface FeedRecord {
  readonly feedId: number
  readonly title: string
  readonly domain: string
  readonly homePageUrl: string | null
  readonly enteredUrl: string
  readonly resolvedUrl: string
}

interface SubscribedFeedRecord extends FeedRecord {
  readonly lastPolledAt: string | null
  readonly lastSuccessAt: string | null
  readonly consecutiveFailures: number
  readonly lastFailureCategory: FeedAvailabilityCategory | null
}

interface PollableFeed extends FeedRecord {
  readonly etag: string | null
  readonly lastModified: string | null
  readonly pollingIntervalMinutes: number
  readonly consecutiveFailures: number
}

/** Keep in sync with `FeedRecord`. */
const FEED_RECORD_COLUMNS = {
  feedId: feeds.id,
  title: feeds.title,
  domain: feeds.domain,
  homePageUrl: feeds.homePageUrl,
  enteredUrl: feeds.enteredUrl,
  resolvedUrl: feeds.resolvedUrl,
}

/** Keep in sync with `SubscribedFeedRecord`. */
const SUBSCRIBED_FEED_COLUMNS = {
  ...FEED_RECORD_COLUMNS,
  lastPolledAt: subscriptions.lastPolledAt,
  lastSuccessAt: subscriptions.lastSuccessAt,
  consecutiveFailures: subscriptions.consecutiveFailures,
  lastFailureCategory: subscriptions.lastFailureCategory,
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

  /** Records the Subscription without contacting the Feed (ADR 0007): unchecked and immediately due. */
  create(enteredUrl: string, offeredTitle?: string | null): CreateSubscriptionOutcome {
    const requestedUrl = canonicalFeedUrl(enteredUrl)
    if (!requestedUrl) return { kind: 'invalid-url' }

    const existing = this.#feedByCanonicalUrl(requestedUrl)
    if (existing) return { kind: 'duplicate', subscription: this.#withCadence(existing) }

    const now = this.#clock.now().toISOString()

    // A Feed the Library kept after an unsubscribe: reuse its identity so old
    // saves and the new Subscription name one Feed.
    const dormant = this.#dormantFeedByUrl(requestedUrl)
    if (dormant) return this.#resubscribe(dormant, now)

    // Both stand in for what the Feed document will say: nothing has been
    // retrieved yet (ADR 0007), so the Feed URL is all there is to go on.
    const domain = new URL(requestedUrl).hostname
    const title = offeredTitle?.trim() || domain
    let created: SubscribedFeedRecord
    try {
      created = this.#db.transaction((tx) => {
        const inserted = tx
          .insert(feeds)
          .values({
            enteredUrl,
            // Stand-in until the first retrieval reveals where the Feed actually answers.
            resolvedUrl: requestedUrl,
            title,
            domain,
            createdAt: now,
            updatedAt: now,
          })
          .run()
        const feedId = Number(inserted.lastInsertRowid)

        tx.insert(feedUrlAliases).values({ url: requestedUrl, feedId }).run()
        tx.insert(subscriptions).values(newSubscription(feedId, now)).run()
        return {
          feedId,
          title,
          domain,
          homePageUrl: null,
          enteredUrl,
          resolvedUrl: requestedUrl,
          lastPolledAt: null,
          lastSuccessAt: null,
          consecutiveFailures: 0,
          lastFailureCategory: null,
        }
      })
    } catch (error) {
      const raced = this.#feedByCanonicalUrl(requestedUrl)
      if (raced) return { kind: 'duplicate', subscription: this.#withCadence(raced) }
      throw error
    }

    this.#logger.info('subscriptions.subscription_created', {
      feedId: created.feedId,
      enteredUrl: loggableUrl(enteredUrl),
    })
    return { kind: 'created', subscription: this.#withCadence(created) }
  }

  /**
   * Revives a retained Feed under the same row — so Library items keep the
   * identity they were saved from — with a fresh default schedule.
   */
  #resubscribe(feed: FeedRecord, now: string): CreateSubscriptionOutcome {
    try {
      this.#db.insert(subscriptions).values(newSubscription(feed.feedId, now)).run()
    } catch (error) {
      const raced = this.#feedByCanonicalUrl(feed.resolvedUrl) ?? this.#feedByCanonicalUrl(feed.enteredUrl)
      if (raced) return { kind: 'duplicate', subscription: this.#withCadence(raced) }
      throw error
    }

    this.#logger.info('subscriptions.subscription_created', {
      feedId: feed.feedId,
      enteredUrl: loggableUrl(feed.enteredUrl),
      revived: true,
    })
    return {
      kind: 'created',
      subscription: this.#withCadence({
        ...feed,
        lastPolledAt: null,
        lastSuccessAt: null,
        consecutiveFailures: 0,
        lastFailureCategory: null,
      }),
    }
  }

  /**
   * Each outline goes through the normal Subscription creation path. Recording is
   * local, so the import is one fast pass; the Feeds are then due at once.
   */
  importOpml(opml: string): ImportOpmlOutcome {
    let outlines
    try {
      outlines = parseOpml(opml)
    } catch (error) {
      if (error instanceof OpmlError) return { kind: 'invalid-opml', code: error.code }
      throw error
    }

    let added = 0
    let alreadySubscribed = 0
    const unusable: string[] = []
    for (const outline of outlines) {
      const outcome = this.create(outline.url, outline.title)
      if (outcome.kind === 'created') added += 1
      else if (outcome.kind === 'duplicate') alreadySubscribed += 1
      else unusable.push(outline.url)
    }

    this.#logger.info('subscriptions.opml_imported', {
      feeds: outlines.length,
      added,
      alreadySubscribed,
      unusable: unusable.length,
    })
    return { kind: 'report', added, alreadySubscribed, unusable }
  }

  exportOpml(): string {
    return serializeOpml(this.#subscribedFeeds(), this.#clock.now())
  }

  async ingest(feedId: number): Promise<IngestFeedOutcome> {
    const feed = this.#pollableFeed(feedId)
    if (!feed) return { kind: 'missing' }

    const outcome = await this.#poll(feed)
    // `missing` records nothing — the Subscription vanished mid-retrieval, so no
    // schedule is left to advance. A merge already recorded success on the surviving Feed.
    if (outcome.kind === 'missing' || outcome.kind === 'merged') return outcome
    if (outcome.kind === 'updated' || outcome.kind === 'not-modified') this.#recordSuccess(feed)
    else if (wasNeverAsked(outcome)) this.#recordDeferral(feed, outcome.failure.code)
    else this.#recordFailure(feed, availabilityCategoryOf(outcome))
    return outcome
  }

  async #poll(feed: PollableFeed): Promise<IngestFeedOutcome> {
    const headers: Record<string, string> = {}
    if (feed.etag) headers['if-none-match'] = feed.etag
    if (feed.lastModified) headers['if-modified-since'] = feed.lastModified

    const retrieved = await this.#retrieval.retrieveBytes({
      url: feed.resolvedUrl,
      operation: 'feed',
      headers,
    })
    if (!retrieved.ok) return { kind: 'retrieval-failed', failure: retrieved }

    if (retrieved.notModified) {
      // A 304 may still rotate the validators; keeping the newest ones keeps
      // later requests conditional. No Feed Item row is touched.
      this.#db
        .update(feeds)
        .set({
          etag: retrieved.etag ?? feed.etag,
          lastModified: retrieved.lastModified ?? feed.lastModified,
        })
        .where(eq(feeds.id, feed.feedId))
        .run()
      this.#logger.info('subscriptions.feed_unchanged', {
        feedId: feed.feedId,
        resolvedUrl: loggableUrl(feed.resolvedUrl),
      })
      return { kind: 'not-modified' }
    }

    let parsed
    try {
      // The entered and requested URLs ride along so a declared site that names a
      // pre-redirect address of this Feed is rejected as its own URL.
      parsed = parseFeedDocument(retrieved.bytes, retrieved.url, [feed.enteredUrl, feed.resolvedUrl])
    } catch (error) {
      if (error instanceof FeedDocumentError) return { kind: 'invalid-feed', code: error.code }
      throw error
    }

    // Two entered URLs can hide one Feed; the retrieval is what reveals it.
    // The later Subscription folds into the existing Feed (ADR 0007).
    const existingFeedId = this.#aliasOwner(retrieved.url)
    if (existingFeedId !== undefined && existingFeedId !== feed.feedId) {
      return this.#mergeInto(feed, existingFeedId, parsed, retrieved)
    }

    const persisted = persistFeedWindow(this.#db, {
      feedId: feed.feedId,
      parsed,
      resolvedUrl: retrieved.url,
      validators: validatorsOf(retrieved),
      now: this.#clock.now().toISOString(),
    })
    if (!persisted) return { kind: 'missing' }
    const observedItems = new Set(parsed.items.map((item) => item.dedupeKey)).size
    this.#logger.info('subscriptions.feed_window_ingested', {
      feedId: feed.feedId,
      enteredUrl: loggableUrl(feed.enteredUrl),
      resolvedUrl: loggableUrl(retrieved.url),
      observedItems,
    })
    return { kind: 'updated', observedItems }
  }

  #aliasOwner(url: string): number | undefined {
    return this.#db
      .select({ feedId: feedUrlAliases.feedId })
      .from(feedUrlAliases)
      .where(eq(feedUrlAliases.url, url))
      .limit(1)
      .all()[0]?.feedId
  }

  /**
   * Produces the state a synchronous duplicate check would have. Nothing retained
   * is deleted: a duplicate with items stays dormant and Retention judges what remains.
   */
  #mergeInto(
    duplicate: PollableFeed,
    existingFeedId: number,
    parsed: ParsedFeedDocument,
    retrieved: RetrievalBytes,
  ): IngestFeedOutcome {
    const now = this.#clock.now().toISOString()
    this.#db.transaction((tx) => {
      const existingSubscribed = tx
        .select({ feedId: subscriptions.feedId })
        .from(subscriptions)
        .where(eq(subscriptions.feedId, existingFeedId))
        .limit(1)
        .all()[0]
      const hasItems = tx
        .select({ id: feedItems.id })
        .from(feedItems)
        .where(eq(feedItems.feedId, duplicate.feedId))
        .limit(1)
        .all()[0]

      // The URLs that led here now name the existing Feed, so a re-import is a
      // duplicate at recording time, not another merge.
      tx.update(feedUrlAliases)
        .set({ feedId: existingFeedId })
        .where(eq(feedUrlAliases.feedId, duplicate.feedId))
        .run()

      if (hasItems) {
        tx.delete(subscriptions).where(eq(subscriptions.feedId, duplicate.feedId)).run()
      } else {
        tx.delete(feeds).where(eq(feeds.id, duplicate.feedId)).run()
      }

      if (!existingSubscribed) {
        tx.insert(subscriptions)
          .values({ ...newSubscription(existingFeedId, now), pollingIntervalMinutes: duplicate.pollingIntervalMinutes })
          .run()
      }
    })

    // Reuse the revealing retrieval as the existing Feed's poll; the merge costs no extra request.
    const existing = this.#pollableFeed(existingFeedId)
    if (existing) {
      persistFeedWindow(this.#db, {
        feedId: existingFeedId,
        parsed,
        resolvedUrl: retrieved.url,
        validators: validatorsOf(retrieved),
        now,
      })
      this.#recordSuccess(existing)
    }

    this.#logger.info('subscriptions.feeds_merged', { feedId: duplicate.feedId, intoFeedId: existingFeedId })
    return { kind: 'merged', intoFeedId: existingFeedId }
  }

  /**
   * The next due time is recomputed from the last completed poll: a shorter,
   * already-overdue interval becomes due at the next wake; a longer one waits it out.
   */
  setPollingInterval(feedId: number, pollingIntervalMinutes: PollingIntervalMinutes): SetPollingIntervalOutcome {
    const row = this.#db
      .select({ lastPolledAt: subscriptions.lastPolledAt, createdAt: subscriptions.createdAt })
      .from(subscriptions)
      .where(eq(subscriptions.feedId, feedId))
      .limit(1)
      .all()[0]
    if (!row) return { kind: 'missing' }

    const anchor = new Date(row.lastPolledAt ?? row.createdAt)
    const nextPollAt = nextPollTime(feedId, pollingIntervalMinutes, anchor)
    this.#db
      .update(subscriptions)
      .set({ pollingIntervalMinutes, nextPollAt })
      .where(eq(subscriptions.feedId, feedId))
      .run()

    this.#logger.info('subscriptions.polling_interval_changed', {
      feedId,
      pollingIntervalMinutes,
      nextPollAt,
    })
    return { kind: 'updated', schedule: { pollingIntervalMinutes, nextPollAt } }
  }

  /**
   * Deletes only the Subscription row — polling and Digest membership hinge on it.
   * Retained rows wait for the retention sweep, which keeps saves and their attribution.
   */
  unsubscribe(feedId: number): UnsubscribeOutcome {
    const deleted = this.#db.delete(subscriptions).where(eq(subscriptions.feedId, feedId)).run()
    if (deleted.changes === 0) return { kind: 'missing' }
    this.#logger.info('subscriptions.unsubscribed', { feedId })
    return { kind: 'unsubscribed' }
  }

  dueFeedIds(limit: number): readonly number[] {
    const now = this.#clock.now().toISOString()
    return this.#db
      .select({ feedId: subscriptions.feedId })
      .from(subscriptions)
      .where(lte(subscriptions.nextPollAt, now))
      .orderBy(subscriptions.nextPollAt)
      .limit(limit)
      .all()
      .map((row) => row.feedId)
  }

  #recordSuccess(feed: PollableFeed): void {
    const now = this.#clock.now()
    this.#db
      .update(subscriptions)
      .set({
        nextPollAt: nextPollTime(feed.feedId, feed.pollingIntervalMinutes, now),
        lastPolledAt: now.toISOString(),
        lastSuccessAt: now.toISOString(),
        lastFailureAt: null,
        consecutiveFailures: 0,
        lastFailureCategory: null,
      })
      .where(eq(subscriptions.feedId, feed.feedId))
      .run()
  }

  /**
   * A failure only lengthens the wait; the User can retry by hand. The Subscription
   * survives — a failing Feed stays subscribed and its Feed Items stay in the Digest.
   */
  #recordFailure(feed: PollableFeed, category: FeedAvailabilityCategory): void {
    const now = this.#clock.now()
    const consecutiveFailures = feed.consecutiveFailures + 1
    const nextPollAt = nextRetryTime(feed.feedId, feed.pollingIntervalMinutes, consecutiveFailures, now)
    this.#db
      .update(subscriptions)
      .set({
        nextPollAt,
        lastPolledAt: now.toISOString(),
        lastFailureAt: now.toISOString(),
        consecutiveFailures,
        lastFailureCategory: category,
      })
      .where(eq(subscriptions.feedId, feed.feedId))
      .run()

    this.#logger.warn('subscriptions.feed_poll_failed', {
      feedId: feed.feedId,
      resolvedUrl: loggableUrl(feed.resolvedUrl),
      category,
      consecutiveFailures,
      nextPollAt,
    })
  }

  /**
   * The publisher was never asked (boundary saturated, or the caller gave up), so
   * Feed Availability is left untouched and the attempt moves one Polling Interval on.
   */
  #recordDeferral(feed: PollableFeed, code: RetrievalFailure['code']): void {
    const now = this.#clock.now()
    this.#db
      .update(subscriptions)
      .set({
        nextPollAt: nextPollTime(feed.feedId, feed.pollingIntervalMinutes, now),
        lastPolledAt: now.toISOString(),
      })
      .where(eq(subscriptions.feedId, feed.feedId))
      .run()

    this.#logger.info('subscriptions.feed_poll_deferred', {
      feedId: feed.feedId,
      resolvedUrl: loggableUrl(feed.resolvedUrl),
      code,
    })
  }

  #pollableFeed(feedId: number): PollableFeed | undefined {
    return this.#db
      .select({
        ...FEED_RECORD_COLUMNS,
        etag: feeds.etag,
        lastModified: feeds.lastModified,
        pollingIntervalMinutes: subscriptions.pollingIntervalMinutes,
        consecutiveFailures: subscriptions.consecutiveFailures,
      })
      .from(feeds)
      .innerJoin(subscriptions, eq(subscriptions.feedId, feeds.id))
      .where(eq(feeds.id, feedId))
      .limit(1)
      .all()[0]
  }

  list(): readonly SubscriptionSummary[] {
    const cadence = this.#cadenceByFeed()
    return this.#subscribedFeeds().map((record) => summaryOf(record, cadence))
  }

  /** Days and labels use the installation timezone, so the cadence grid reads in the User's own calendar. */
  detail(feedId: number): FeedDetail | undefined {
    const record = this.#db
      .select({
        ...SUBSCRIBED_FEED_COLUMNS,
        pollingIntervalMinutes: subscriptions.pollingIntervalMinutes,
        nextPollAt: subscriptions.nextPollAt,
      })
      .from(feeds)
      .innerJoin(subscriptions, eq(subscriptions.feedId, feeds.id))
      .where(eq(feeds.id, feedId))
      .limit(1)
      .all()[0]
    if (!record) return undefined

    const timezone = this.#settings.effectiveTimezone()
    const now = this.#clock.now()
    const today = dateKey(now, timezone)

    const rows = this.#db
      .select({
        feedItemId: feedItems.id,
        title: feedItems.title,
        link: feedItems.link,
        publishedAt: feedItems.publishedAt,
        firstSeenAt: feedItems.firstSeenAt,
        savedAt: libraryItems.savedAt,
      })
      .from(feedItems)
      .leftJoin(libraryItems, eq(libraryItems.feedItemId, feedItems.id))
      .where(eq(feedItems.feedId, feedId))
      .all()
      .map((row) => ({ row, chronology: chronologyTime(row.publishedAt, row.firstSeenAt, now) }))
      .sort((left, right) => right.chronology - left.chronology || right.row.feedItemId - left.row.feedItemId)

    const counts = new Map<string, number>()
    const items: FeedItemRow[] = rows.map(({ row, chronology }) => {
      const instant = new Date(chronology)
      const date = dateKey(instant, timezone)
      counts.set(date, (counts.get(date) ?? 0) + 1)
      return {
        feedItemId: row.feedItemId,
        title: row.title ?? 'untitled',
        link: row.link,
        publishedAt: row.publishedAt,
        firstSeenAt: row.firstSeenAt,
        date,
        displayDate: metaRowDate(instant, date, today, timezone),
        saved: row.savedAt !== null,
      }
    })

    return {
      feedId: record.feedId,
      title: record.title,
      domain: record.domain,
      homePageUrl: record.homePageUrl,
      enteredUrl: record.enteredUrl,
      resolvedUrl: record.resolvedUrl,
      availability: availabilityOf(record),
      schedule: {
        pollingIntervalMinutes: pollingIntervalMinutesSchema.parse(record.pollingIntervalMinutes),
        nextPollAt: record.nextPollAt,
      },
      cadence: gridDayKeys(today).map((date) => ({ date, count: counts.get(date) ?? 0 })),
      items,
    }
  }

  #subscribedFeeds(): readonly SubscribedFeedRecord[] {
    return this.#db
      .select(SUBSCRIBED_FEED_COLUMNS)
      .from(feeds)
      .innerJoin(subscriptions, eq(subscriptions.feedId, feeds.id))
      .orderBy(feeds.title)
      .all()
  }

  #withCadence(feed: SubscribedFeedRecord): SubscriptionSummary {
    return summaryOf(feed, this.#cadenceByFeed())
  }

  #feedByCanonicalUrl(url: string): SubscribedFeedRecord | undefined {
    return this.#db
      .select(SUBSCRIBED_FEED_COLUMNS)
      .from(feedUrlAliases)
      .innerJoin(feeds, eq(feeds.id, feedUrlAliases.feedId))
      .innerJoin(subscriptions, eq(subscriptions.feedId, feeds.id))
      .where(eq(feedUrlAliases.url, url))
      .limit(1)
      .all()[0]
  }

  /** Unsubscribed but still on the volume: its Library items kept it. */
  #dormantFeedByUrl(url: string): FeedRecord | undefined {
    return this.#db
      .select(FEED_RECORD_COLUMNS)
      .from(feedUrlAliases)
      .innerJoin(feeds, eq(feeds.id, feedUrlAliases.feedId))
      .leftJoin(subscriptions, eq(subscriptions.feedId, feeds.id))
      .where(and(eq(feedUrlAliases.url, url), isNull(subscriptions.feedId)))
      .limit(1)
      .all()[0]
  }

  #cadenceByFeed(): Map<number, number[]> {
    const timezone = this.#settings.effectiveTimezone()
    const now = this.#clock.now()
    const today = dateKey(now, timezone)
    const indexByDate = new Map(trailingDayKeys(today, 30).map((key, index) => [key, index]))

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

/** The attempt never reached the publisher, so it says nothing about the Feed. */
function wasNeverAsked(
  outcome: Extract<IngestFeedOutcome, { kind: 'retrieval-failed' } | { kind: 'invalid-feed' }>,
): outcome is Extract<IngestFeedOutcome, { kind: 'retrieval-failed' }> {
  return (
    outcome.kind === 'retrieval-failed' &&
    (outcome.failure.code === 'busy' || outcome.failure.code === 'cancelled')
  )
}

/**
 * Everything the network refused to answer collapses into `unreachable`; the
 * finer distinctions are transport detail the User cannot act on.
 */
export function availabilityCategoryOf(
  outcome: Extract<IngestFeedOutcome, { kind: 'retrieval-failed' } | { kind: 'invalid-feed' }>,
): FeedAvailabilityCategory {
  if (outcome.kind === 'invalid-feed') return 'invalid_feed'
  switch (outcome.failure.code) {
    // Never answered and answered too slowly both read as `timeout`; the User cannot act on the difference.
    case 'timeout':
    case 'body_timeout':
      return 'timeout'
    case 'too_large':
      return 'too_large'
    case 'unsupported_content_type':
    case 'unsupported_content_encoding':
      return 'unsupported_content'
    case 'http_error':
      return 'http_error'
    default:
      return 'unreachable'
  }
}

/** Shared by first subscription and revival: due immediately — the first retrieval is scheduler work (ADR 0007). */
function newSubscription(feedId: number, now: string) {
  return {
    feedId,
    pollingIntervalMinutes: DEFAULT_POLLING_INTERVAL_MINUTES,
    nextPollAt: now,
    createdAt: now,
  }
}

function summaryOf(record: SubscribedFeedRecord, cadence: Map<number, number[]>): SubscriptionSummary {
  return {
    feedId: record.feedId,
    title: record.title,
    domain: record.domain,
    homePageUrl: record.homePageUrl,
    enteredUrl: record.enteredUrl,
    resolvedUrl: record.resolvedUrl,
    cadence: cadence.get(record.feedId) ?? emptyCadence(),
    availability: availabilityOf(record),
  }
}

function availabilityOf(record: SubscribedFeedRecord): FeedAvailability {
  return {
    state:
      record.consecutiveFailures >= FEED_UNAVAILABLE_AFTER_FAILURES
        ? 'unavailable'
        : record.lastSuccessAt === null
          ? 'unchecked'
          : 'available',
    lastCheckedAt: record.lastPolledAt,
    lastSuccessAt: record.lastSuccessAt,
    consecutiveFailures: record.consecutiveFailures,
    category: record.lastFailureCategory,
  }
}

function validatorsOf(retrieved: {
  readonly etag: string | undefined
  readonly lastModified: string | undefined
}): { etag: string | null; lastModified: string | null } {
  return { etag: retrieved.etag ?? null, lastModified: retrieved.lastModified ?? null }
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

/** Logged URLs drop the query string. */
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

