import { and, eq, isNull, lte } from 'drizzle-orm'
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
import type { Logger } from '../logger.js'
import type { DrizzleDatabase } from '../persistence/database.js'
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
import { gridDayKeys, stripCadenceByFeed } from './cadence-window.js'
import { availabilityOf, type PolledFeed, type RecordedAvailability } from './feed-availability.js'
import { loggableUrl } from './loggable-url.js'
import { OpmlError, parseOpml, serializeOpml, type OpmlFailureCode, type OpmlFeedOutline } from './opml.js'
import { nextPollTime } from './polling-schedule.js'

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

export type SetPollingIntervalOutcome =
  | { readonly kind: 'updated'; readonly schedule: PollingSchedule }
  | { readonly kind: 'missing' }

export type UnsubscribeOutcome = { readonly kind: 'unsubscribed' } | { readonly kind: 'missing' }

export type SetFeedDetailsOutcome =
  | { readonly kind: 'updated'; readonly details: FeedDetailsUpdate }
  | { readonly kind: 'missing' }

interface FeedRecord {
  readonly feedId: number
  readonly title: string
  readonly description: string | null
  readonly domain: string
  readonly homePageUrl: string | null
  readonly enteredUrl: string
  readonly resolvedUrl: string
}

interface SubscribedFeedRecord extends FeedRecord, RecordedAvailability {}

const FEED_RECORD_COLUMNS = {
  feedId: feeds.id,
  title: feeds.title,
  description: feeds.description,
  domain: feeds.domain,
  homePageUrl: feeds.homePageUrl,
  enteredUrl: feeds.enteredUrl,
  resolvedUrl: feeds.resolvedUrl,
}

const SUBSCRIBED_FEED_COLUMNS = {
  ...FEED_RECORD_COLUMNS,
  title: effectiveFeedTitle,
  description: effectiveFeedDescription,
  lastPolledAt: subscriptions.lastPolledAt,
  lastSuccessAt: subscriptions.lastSuccessAt,
  consecutiveFailures: subscriptions.consecutiveFailures,
  lastFailureCategory: subscriptions.lastFailureCategory,
}

/** Subscribing, unsubscribing, and the reads the UI is built from. Every write to a Subscription row is here. */
export class SubscriptionService {
  readonly #db: DrizzleDatabase
  readonly #clock: Clock
  readonly #settings: InstallationSettingsStore
  readonly #logger: Logger

  constructor(options: {
    db: DrizzleDatabase
    clock: Clock
    settings: InstallationSettingsStore
    logger: Logger
  }) {
    this.#db = options.db
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
          description: null,
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

  /**
   * Folds a duplicate Subscription into the Feed its retrieval revealed (ADR 0007).
   * Called by `FeedPoll`, which then writes the retrieved Feed Window to the survivor:
   * the poll discovers the duplicate, but the Subscription writes belong here.
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
    const records = this.#subscribedFeeds()
    const cadenceOf = this.#stripCadence(records.map((record) => record.feedId))
    return records.map((record) => summaryOf(record, cadenceOf))
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

  #withCadence(feed: SubscribedFeedRecord): SubscriptionSummary {
    return summaryOf(feed, this.#stripCadence([feed.feedId]))
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

  #stripCadence(feedIds: readonly number[]): (feedId: number) => number[] {
    return stripCadenceByFeed(this.#db, this.#settings.effectiveTimezone(), this.#clock.now(), feedIds)
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

function summaryOf(record: SubscribedFeedRecord, cadenceOf: (feedId: number) => number[]): SubscriptionSummary {
  return {
    feedId: record.feedId,
    title: record.title,
    description: record.description,
    domain: record.domain,
    homePageUrl: record.homePageUrl,
    enteredUrl: record.enteredUrl,
    resolvedUrl: record.resolvedUrl,
    cadence: cadenceOf(record.feedId),
    availability: availabilityOf(record),
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
