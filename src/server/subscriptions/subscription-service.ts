import { eq, lte } from 'drizzle-orm'
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
import { gridDayKeys, trailingDayKeys } from './cadence-window.js'
import { OpmlError, parseOpml, serializeOpml, type OpmlFailureCode } from './opml.js'
import { nextPollTime, nextRetryTime } from './polling-schedule.js'

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
  | { readonly kind: 'not-modified' }
  | { readonly kind: 'missing' }
  | { readonly kind: 'retrieval-failed'; readonly failure: RetrievalFailure }
  | { readonly kind: 'invalid-feed'; readonly code: FeedDocumentError['code'] }

export type SetPollingIntervalOutcome =
  | { readonly kind: 'updated'; readonly schedule: PollingSchedule }
  | { readonly kind: 'missing' }

interface FeedRecord {
  readonly feedId: number
  readonly title: string
  readonly domain: string
  readonly enteredUrl: string
  readonly resolvedUrl: string
}

/** A Feed the Owner is subscribed to, with its recorded Feed Availability. */
interface SubscribedFeedRecord extends FeedRecord {
  readonly lastPolledAt: string | null
  readonly lastSuccessAt: string | null
  readonly consecutiveFailures: number
  readonly lastFailureCategory: FeedAvailabilityCategory | null
}

/** What one poll needs: where to ask, how to ask conditionally, and the schedule. */
interface PollableFeed extends FeedRecord {
  readonly etag: string | null
  readonly lastModified: string | null
  readonly pollingIntervalMinutes: number
  readonly consecutiveFailures: number
}

/** The one shape every Feed lookup selects, mirrored by `FeedRecord`. */
const FEED_RECORD_COLUMNS = {
  feedId: feeds.id,
  title: feeds.title,
  domain: feeds.domain,
  enteredUrl: feeds.enteredUrl,
  resolvedUrl: feeds.resolvedUrl,
}

/** `FEED_RECORD_COLUMNS` plus the Feed Availability state, as `SubscribedFeedRecord`. */
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
    let created: SubscribedFeedRecord
    try {
      created = this.#db.transaction((tx) => {
        const inserted = tx
          .insert(feeds)
          .values({
            enteredUrl,
            resolvedUrl: retrieved.url,
            title: parsed.title,
            domain,
            ...validatorsOf(retrieved),
            createdAt: now,
            updatedAt: now,
          })
          .run()
        const feedId = Number(inserted.lastInsertRowid)

        const aliases = [...new Set([requestedUrl, retrieved.url])].map((url) => ({ url, feedId }))
        tx.insert(feedUrlAliases).values(aliases).run()
        // The initial import counts as a successful poll, so the first
        // background check lands one full interval plus this Feed's jitter
        // from now, and Feed Availability starts from an observed success.
        tx.insert(subscriptions)
          .values({
            feedId,
            pollingIntervalMinutes: DEFAULT_POLLING_INTERVAL_MINUTES,
            nextPollAt: nextPollTime(feedId, DEFAULT_POLLING_INTERVAL_MINUTES, new Date(now)),
            lastPolledAt: now,
            lastSuccessAt: now,
            createdAt: now,
          })
          .run()

        for (const item of parsed.items) upsertFeedItem(tx, feedId, item, now)
        return {
          feedId,
          title: parsed.title,
          domain,
          enteredUrl,
          resolvedUrl: retrieved.url,
          lastPolledAt: now,
          lastSuccessAt: now,
          consecutiveFailures: 0,
          lastFailureCategory: null,
        }
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

  /**
   * One poll of one subscribed Feed, from wherever it was asked for — the
   * scheduler or a manual refresh.
   */
  async ingest(feedId: number): Promise<IngestFeedOutcome> {
    const feed = this.#pollableFeed(feedId)
    if (!feed) return { kind: 'missing' }

    const outcome = await this.#poll(feed)
    // Every completed attempt is recorded and advances the schedule: a
    // success by one Polling Interval, a failure by an exponential backoff,
    // so a struggling Feed is retried patiently rather than every minute.
    if (outcome.kind === 'updated' || outcome.kind === 'not-modified') this.#recordSuccess(feed)
    else if (wasNeverAsked(outcome)) this.#recordDeferral(feed, outcome.failure.code)
    else this.#recordFailure(feed, availabilityCategoryOf(outcome))
    return outcome
  }

  async #poll(feed: PollableFeed): Promise<Exclude<IngestFeedOutcome, { kind: 'missing' }>> {
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
      // The publisher confirmed the stored Feed Window is current, so no Feed
      // Item row is touched. A 304 may still rotate the validators; keeping
      // the newest ones is what keeps later requests conditional.
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
      parsed = parseFeedDocument(retrieved.bytes, retrieved.url)
    } catch (error) {
      if (error instanceof FeedDocumentError) return { kind: 'invalid-feed', code: error.code }
      throw error
    }

    persistFeedWindow(this.#db, {
      feedId: feed.feedId,
      parsed,
      resolvedUrl: retrieved.url,
      validators: validatorsOf(retrieved),
      now: this.#clock.now().toISOString(),
    })
    const observedItems = new Set(parsed.items.map((item) => item.dedupeKey)).size
    this.#logger.info('subscriptions.feed_window_ingested', {
      feedId: feed.feedId,
      enteredUrl: loggableUrl(feed.enteredUrl),
      resolvedUrl: loggableUrl(retrieved.url),
      observedItems,
    })
    return { kind: 'updated', observedItems }
  }

  /**
   * Changes one Subscription's Polling Interval. The next due time is
   * recomputed from the last completed poll, so a shorter interval that is
   * already overdue becomes due at the scheduler's next wake, and a longer one
   * calmly waits out its new interval.
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

  /** Feed ids whose persisted due time has arrived, oldest frontier first. */
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

  /** A success clears the whole failure run; the Feed is simply available. */
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
   * A failure lengthens the wait before the next attempt instead of shortening
   * it: hammering a Feed that is struggling helps nobody, and the Owner can
   * always retry by hand. The Subscription itself is never touched — a failing
   * Feed stays subscribed and its retained Feed Items stay in the Digest.
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
   * The retrieval never asked the publisher anything — the installation's own
   * boundary was saturated, or the caller gave up. That is not the Feed's
   * failure, so its Feed Availability is left exactly as it stands and the
   * attempt simply moves one ordinary Polling Interval on.
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

  /**
   * One opened Feed: its retained Feed Items newest first, the day-by-day
   * cadence observations behind the 26-week grid, and the polling behaviour
   * the Owner manages from there. Days and labels use the installation
   * timezone, so the grid reads in the Owner's own calendar.
   */
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
      })
      .from(feedItems)
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
        displayDate: displayDate(instant, date, today, timezone),
      }
    })

    return {
      feedId: record.feedId,
      title: record.title,
      domain: record.domain,
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

/**
 * True when this attempt never reached the publisher at all: the boundary was
 * saturated or the caller gave up. Such an attempt says nothing about the Feed.
 */
function wasNeverAsked(
  outcome: Extract<IngestFeedOutcome, { kind: 'retrieval-failed' } | { kind: 'invalid-feed' }>,
): outcome is Extract<IngestFeedOutcome, { kind: 'retrieval-failed' }> {
  return (
    outcome.kind === 'retrieval-failed' &&
    (outcome.failure.code === 'busy' || outcome.failure.code === 'cancelled')
  )
}

/**
 * The safe category one failed poll is remembered as. Retrieval, parse,
 * timeout, size, and content-type failures stay distinguishable; everything
 * the network refused to answer collapses into `unreachable`, because the
 * distinctions below that are transport detail the Owner cannot act on.
 */
export function availabilityCategoryOf(
  outcome: Extract<IngestFeedOutcome, { kind: 'retrieval-failed' } | { kind: 'invalid-feed' }>,
): FeedAvailabilityCategory {
  if (outcome.kind === 'invalid-feed') return 'invalid_feed'
  switch (outcome.failure.code) {
    case 'timeout':
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

/** The one place a stored Subscription becomes the summary the API answers with. */
function summaryOf(record: SubscribedFeedRecord, cadence: Map<number, number[]>): SubscriptionSummary {
  return {
    feedId: record.feedId,
    title: record.title,
    domain: record.domain,
    enteredUrl: record.enteredUrl,
    resolvedUrl: record.resolvedUrl,
    cadence: cadence.get(record.feedId) ?? emptyCadence(),
    availability: availabilityOf(record),
  }
}

/** How a Subscription's recorded state reads as calm Feed Availability. */
function availabilityOf(record: SubscribedFeedRecord): FeedAvailability {
  return {
    state: record.consecutiveFailures >= FEED_UNAVAILABLE_AFTER_FAILURES ? 'unavailable' : 'available',
    lastCheckedAt: record.lastPolledAt,
    lastSuccessAt: record.lastSuccessAt,
    consecutiveFailures: record.consecutiveFailures,
    category: record.lastFailureCategory,
  }
}

/** What this retrieval said to remember for the next conditional request. */
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

/**
 * The meta-row date inside one Feed, where the day carries the meaning the
 * Digest's grouping would otherwise give: `today, 07:15`, `yesterday, 09:31`,
 * then `3 august`, with the year only once it stops being this one.
 */
function displayDate(instant: Date, itemDate: string, today: string, timezone: string): string {
  if (itemDate === today) return `today, ${timeLabel(instant, timezone)}`
  const yesterday = trailingDayKeys(today, 2)[0]
  if (itemDate === yesterday) return `yesterday, ${timeLabel(instant, timezone)}`

  const sameYear = itemDate.slice(0, 4) === today.slice(0, 4)
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    day: 'numeric',
    month: 'long',
    ...(sameYear ? {} : { year: 'numeric' }),
  })
    .format(instant)
    .toLowerCase()
}

function timeLabel(date: Date, timezone: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(date)
}
