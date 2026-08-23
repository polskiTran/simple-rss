import { eq, lte } from 'drizzle-orm'
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import {
  DEFAULT_POLLING_INTERVAL_MINUTES,
  pollingIntervalMinutesSchema,
  type FeedDetail,
  type FeedDetailsUpdate,
  type FeedItemRow,
  type PollingIntervalMinutes,
  type PollingSchedule,
  type SubscriptionSummary,
  type UpdateFeedDetailsRequest,
} from '../../shared/api.js'
import type { Clock } from '../clock.js'
import { chronologyTime, dateKey, metaRowDate } from '../digest/chronology.js'
import { feedColumnsOf, observedItemCount, persistFeedWindow } from '../ingestion/feed-window.js'
import type { Logger } from '../logger.js'
import type { SqliteDatabase } from '../persistence/database.js'
import type { InstallationSettingsStore } from '../persistence/installation-settings.js'
import {
  effectiveFeedDescription,
  effectiveFeedTitle,
  feedItems,
  feeds,
  feedUrlAliases,
  libraryItems,
  subscriptions,
} from '../persistence/schema.js'
import { PAGE_CONTENT_TYPES, type Retrieval } from '../upstream/retrieval.js'
import { gridDayKeys, trailingDayKeys } from './cadence-window.js'
import {
  availabilityAfterSuccess,
  availabilityOf,
  type FailedPoll,
  type PolledFeed,
  type RecordedAvailability,
} from './feed-availability.js'
import { loggableUrl } from './loggable-url.js'
import { OpmlError, parseOpml, serializeOpml, type OpmlFailureCode, type OpmlFeedOutline } from './opml.js'
import { nextPollTime } from './polling-schedule.js'
import { proveFeed } from './prove-feed.js'

export type SubscribeOutcome =
  | { readonly kind: 'subscribed'; readonly subscription: SubscriptionSummary; readonly observedItems: number }
  | { readonly kind: 'duplicate'; readonly subscription: SubscriptionSummary }
  | { readonly kind: 'invalid-url' }
  | { readonly kind: 'no-feed-found' }
  | FailedPoll

export type RecordSubscriptionOutcome =
  | { readonly kind: 'recorded' }
  | { readonly kind: 'duplicate' }
  | { readonly kind: 'invalid-url' }

export type ImportOpmlOutcome =
  | { readonly kind: 'invalid-opml'; readonly code: OpmlFailureCode }
  | {
      readonly kind: 'report'
      readonly added: number
      readonly alreadySubscribed: number
      readonly unusable: readonly string[]
    }

export type SetPollingIntervalOutcome =
  | { readonly kind: 'updated'; readonly schedule: PollingSchedule }
  | { readonly kind: 'missing' }

export type UnsubscribeOutcome = { readonly kind: 'unsubscribed' } | { readonly kind: 'missing' }

export type SetFeedDetailsOutcome =
  | { readonly kind: 'updated'; readonly details: FeedDetailsUpdate }
  | { readonly kind: 'missing' }

interface SubscribedFeedRecord extends RecordedAvailability {
  readonly feedId: number
  readonly title: string
  readonly description: string | null
  readonly domain: string
  readonly homePageUrl: string | null
  readonly enteredUrl: string
  readonly resolvedUrl: string
}

const SUBSCRIBED_FEED_COLUMNS = {
  feedId: feeds.id,
  title: effectiveFeedTitle,
  description: effectiveFeedDescription,
  domain: feeds.domain,
  homePageUrl: feeds.homePageUrl,
  enteredUrl: feeds.enteredUrl,
  resolvedUrl: feeds.resolvedUrl,
  lastPolledAt: subscriptions.lastPolledAt,
  lastSuccessAt: subscriptions.lastSuccessAt,
  consecutiveFailures: subscriptions.consecutiveFailures,
  lastFailureCategory: subscriptions.lastFailureCategory,
}

/** Subscribing, unsubscribing, and the reads the UI is built from. Every write to a Subscription row is here. */
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

  /** Proves the Feed inside the request (ADR 0009). */
  async subscribe(enteredUrl: string): Promise<SubscribeOutcome> {
    const requestedUrl = canonicalFeedUrl(enteredUrl)
    if (!requestedUrl) return { kind: 'invalid-url' }

    const proof = await proveFeed({ retrieval: this.#retrieval, url: requestedUrl, operation: 'preview' })
    if (proof.kind !== 'proven') return answeredWithPage(proof) ? { kind: 'no-feed-found' } : proof
    const { retrieved, parsed } = proof

    const owner = this.#aliasOwner(retrieved.url, requestedUrl)
    if (owner?.subscribed) return { kind: 'duplicate', subscription: this.#subscribed(owner.feedId) }

    const now = this.#clock.now()
    const provenAt = now.toISOString()
    let feedId: number
    try {
      feedId = this.#db.transaction((tx) => {
        const feedId =
          owner?.feedId ??
          Number(
            tx
              .insert(feeds)
              .values({ enteredUrl, ...feedColumnsOf(parsed, retrieved.url), createdAt: provenAt, updatedAt: provenAt })
              .run().lastInsertRowid,
          )
        tx.insert(feedUrlAliases).values({ url: requestedUrl, feedId }).onConflictDoNothing().run()
        tx.insert(subscriptions)
          .values({
            feedId,
            pollingIntervalMinutes: DEFAULT_POLLING_INTERVAL_MINUTES,
            createdAt: provenAt,
            ...availabilityAfterSuccess({ feedId, pollingIntervalMinutes: DEFAULT_POLLING_INTERVAL_MINUTES }, now),
          })
          .run()
        persistFeedWindow(tx, {
          feedId,
          parsed,
          resolvedUrl: retrieved.url,
          validators: { etag: retrieved.etag ?? null, lastModified: retrieved.lastModified ?? null },
          now: provenAt,
        })
        return feedId
      })
    } catch (error) {
      const raced = this.#aliasOwner(retrieved.url, requestedUrl)
      if (raced?.subscribed) return { kind: 'duplicate', subscription: this.#subscribed(raced.feedId) }
      throw error
    }

    const observedItems = observedItemCount(parsed)
    this.#logger.info('subscriptions.subscription_created', {
      feedId,
      enteredUrl: loggableUrl(enteredUrl),
      resolvedUrl: loggableUrl(retrieved.url),
      revived: owner !== undefined,
      observedItems,
    })
    return { kind: 'subscribed', subscription: this.#subscribed(feedId), observedItems }
  }

  /** Records without contacting the Feed (ADR 0009). */
  recordImported(enteredUrl: string, offeredTitle?: string | null): RecordSubscriptionOutcome {
    const requestedUrl = canonicalFeedUrl(enteredUrl)
    if (!requestedUrl) return { kind: 'invalid-url' }

    const owner = this.#aliasOwner(requestedUrl)
    if (owner?.subscribed) return { kind: 'duplicate' }

    const now = this.#clock.now().toISOString()
    const domain = new URL(requestedUrl).hostname
    let feedId: number
    try {
      feedId = this.#db.transaction((tx) => {
        const feedId =
          owner?.feedId ??
          Number(
            tx
              .insert(feeds)
              .values({
                enteredUrl,
                resolvedUrl: requestedUrl,
                title: offeredTitle?.trim() || domain,
                domain,
                createdAt: now,
                updatedAt: now,
              })
              .run().lastInsertRowid,
          )
        tx.insert(feedUrlAliases).values({ url: requestedUrl, feedId }).onConflictDoNothing().run()
        tx.insert(subscriptions).values(newSubscription(feedId, now)).run()
        return feedId
      })
    } catch (error) {
      if (this.#aliasOwner(requestedUrl)?.subscribed) return { kind: 'duplicate' }
      throw error
    }

    this.#logger.info('subscriptions.subscription_created', {
      feedId,
      enteredUrl: loggableUrl(enteredUrl),
      revived: owner !== undefined,
      imported: true,
    })
    return { kind: 'recorded' }
  }

  importOpml(opml: string): ImportOpmlOutcome {
    let outlines: readonly OpmlFeedOutline[]
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
      const outcome = this.recordImported(outline.url, outline.title)
      if (outcome.kind === 'recorded') added += 1
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

  /**
   * Folds a duplicate Subscription into the Feed its retrieval revealed (ADR 0009).
   * Called by `FeedPoll`, which then writes the retrieved Feed Window to the
   * survivor: the poll discovers the duplicate, but the Subscription writes
   * belong here.
   */
  mergeInto(duplicate: PolledFeed, existingFeedId: number): void {
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

      tx.update(feedUrlAliases).set({ feedId: existingFeedId }).where(eq(feedUrlAliases.feedId, duplicate.feedId)).run()

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

    this.#logger.info('subscriptions.feeds_merged', { feedId: duplicate.feedId, intoFeedId: existingFeedId })
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

  /** Replaces both overrides; the Feed's reported title and description keep being tracked underneath. */
  setFeedDetails(feedId: number, overrides: UpdateFeedDetailsRequest): SetFeedDetailsOutcome {
    const row = this.#db
      .select({ reportedTitle: feeds.title, reportedDescription: feeds.description })
      .from(subscriptions)
      .innerJoin(feeds, eq(feeds.id, subscriptions.feedId))
      .where(eq(subscriptions.feedId, feedId))
      .limit(1)
      .all()[0]
    if (!row) return { kind: 'missing' }

    const { customTitle, customDescription } = overrides
    this.#db.update(subscriptions).set({ customTitle, customDescription }).where(eq(subscriptions.feedId, feedId)).run()

    this.#logger.info('subscriptions.feed_details_changed', {
      feedId,
      customTitle: customTitle !== null,
      customDescription: customDescription !== null,
    })
    return {
      kind: 'updated',
      details: {
        title: customTitle ?? row.reportedTitle,
        customTitle,
        description: customDescription ?? row.reportedDescription,
        customDescription,
      },
    }
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

  list(): readonly SubscriptionSummary[] {
    const cadence = this.#cadenceByFeed()
    return this.#subscribedFeeds().map((record) => summaryOf(record, cadence))
  }

  /** Days and labels use the installation timezone, so the cadence grid reads in the User's own calendar. */
  detail(feedId: number): FeedDetail | undefined {
    const record = this.#db
      .select({
        ...SUBSCRIBED_FEED_COLUMNS,
        reportedTitle: feeds.title,
        customTitle: subscriptions.customTitle,
        reportedDescription: feeds.description,
        customDescription: subscriptions.customDescription,
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
      description: record.description,
      reportedTitle: record.reportedTitle,
      customTitle: record.customTitle,
      reportedDescription: record.reportedDescription,
      customDescription: record.customDescription,
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

  /** Ordered by effective title — the order of the Feeds list and of OPML export alike. */
  #subscribedFeeds(): readonly SubscribedFeedRecord[] {
    return this.#db
      .select(SUBSCRIBED_FEED_COLUMNS)
      .from(feeds)
      .innerJoin(subscriptions, eq(subscriptions.feedId, feeds.id))
      .orderBy(effectiveFeedTitle)
      .all()
  }

  #subscribed(feedId: number): SubscriptionSummary {
    const record = this.#db
      .select(SUBSCRIBED_FEED_COLUMNS)
      .from(feeds)
      .innerJoin(subscriptions, eq(subscriptions.feedId, feeds.id))
      .where(eq(feeds.id, feedId))
      .limit(1)
      .all()[0]
    if (!record) throw new Error(`Feed ${feedId} is not subscribed`)
    return summaryOf(record, this.#cadenceByFeed())
  }

  #aliasOwner(...urls: readonly string[]): { readonly feedId: number; readonly subscribed: boolean } | undefined {
    for (const url of urls) {
      const row = this.#db
        .select({ feedId: feedUrlAliases.feedId, subscribedFeedId: subscriptions.feedId })
        .from(feedUrlAliases)
        .leftJoin(subscriptions, eq(subscriptions.feedId, feedUrlAliases.feedId))
        .where(eq(feedUrlAliases.url, url))
        .limit(1)
        .all()[0]
      if (row) return { feedId: row.feedId, subscribed: row.subscribedFeedId !== null }
    }
    return undefined
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
    description: record.description,
    domain: record.domain,
    homePageUrl: record.homePageUrl,
    enteredUrl: record.enteredUrl,
    resolvedUrl: record.resolvedUrl,
    cadence: cadence.get(record.feedId) ?? emptyCadence(),
    availability: availabilityOf(record),
  }
}

function answeredWithPage(proof: FailedPoll): boolean {
  return (
    proof.kind === 'retrieval-failed' &&
    proof.failure.code === 'unsupported_content_type' &&
    PAGE_CONTENT_TYPES.includes(proof.failure.contentType ?? '')
  )
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
