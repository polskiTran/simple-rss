import { and, desc, eq, isNull, lte, or } from 'drizzle-orm'
import type {
  FeedDetail,
  FeedDetailsUpdate,
  PollingIntervalMinutes,
  PollingSchedule,
  ReadingSource,
  SubscriptionSummary,
  UpdateFeedDetailsRequest,
} from '../../shared/api.js'
import type { Clock } from '../clock.js'
import { dateKey, dayKeysIn, timeLabel } from '../calendar.js'
import type { Logger } from '../logger.js'
import type { DrizzleDatabase } from '../persistence/database.js'
import type { InstallationSettingsStore } from '../persistence/installation-settings.js'
import { LISTED_ITEM_COLUMNS, listedItemOf } from '../persistence/listed-item.js'
import {
  effectiveFeedDescription,
  effectiveFeedTitle,
  feedItems,
  feeds,
  feedUrlAliases,
  libraryItems,
  subscriptions,
} from '../persistence/schema.js'
import { cadenceByFeed, gridDayKeys, stripCadenceByFeed } from '../digest/cadence-window.js'
import { availabilityOf, type RecordedAvailability } from './feed-availability.js'
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

interface FeedRecord {
  readonly feedId: number
  readonly title: string
  readonly description: string | null
  readonly domain: string
  readonly homePageUrl: string | null
  readonly enteredUrl: string
  readonly resolvedUrl: string
}

interface SubscribedFeedRecord extends FeedRecord, RecordedAvailability {
  readonly readingSource: ReadingSource
  readonly subscribedAt: string
}

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
  readingSource: subscriptions.readingSource,
  subscribedAt: subscriptions.createdAt,
}

/**
 * The User's Subscription changes — subscribing, OPML, preferences, unsubscribing —
 * and the reads the UI is built from. Poll outcomes are written by `FeedPoll`.
 */
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
    const dormant = this.#dormantFeed(requestedUrl, enteredUrl)
    if (dormant) this.#resubscribe(dormant, requestedUrl, now)
    else this.#subscribe(enteredUrl, requestedUrl, offeredTitle, now)

    // Read back rather than restated: the row's defaults are the only defaults.
    const recorded = this.#feedByCanonicalUrl(requestedUrl)
    if (!recorded) throw new Error('A Subscription just recorded did not read back')
    return { kind: 'created', subscription: this.#withCadence(recorded) }
  }

  #subscribe(enteredUrl: string, requestedUrl: string, offeredTitle: string | null | undefined, now: string): void {
    // Both stand in for what the Feed document will say: nothing has been
    // retrieved yet (ADR 0007), so the Feed URL is all there is to go on.
    const domain = new URL(requestedUrl).hostname
    const title = offeredTitle?.trim() || domain
    const feedId = this.#db.transaction((tx) => {
      const inserted = tx
        .insert(feeds)
        .values({ enteredUrl, resolvedUrl: requestedUrl, title, domain, createdAt: now, updatedAt: now })
        .run()
      const feedId = Number(inserted.lastInsertRowid)
      tx.insert(feedUrlAliases).values({ url: requestedUrl, feedId }).run()
      tx.insert(subscriptions).values(newSubscription(feedId, now)).run()
      return feedId
    })

    this.#logger.info('subscriptions.subscription_created', { feedId, enteredUrl: loggableUrl(enteredUrl) })
  }

  /**
   * Revives a retained Feed under the same row — so Library items keep the
   * identity they were saved from — with a fresh default schedule, reclaiming
   * the requested URL's alias if a merge had moved it away.
   */
  #resubscribe(feed: FeedRecord, requestedUrl: string, now: string): void {
    this.#db.transaction((tx) => {
      tx.insert(feedUrlAliases).values({ url: requestedUrl, feedId: feed.feedId }).onConflictDoNothing().run()
      tx.insert(subscriptions).values(newSubscription(feed.feedId, now)).run()
    })

    this.#logger.info('subscriptions.subscription_created', {
      feedId: feed.feedId,
      enteredUrl: loggableUrl(feed.enteredUrl),
      revived: true,
    })
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
   * The next due time is recomputed from the last completed poll: a shorter,
   * already-overdue interval becomes due at the next wake; a longer one waits it out.
   */
  setPollingInterval(feedId: number, pollingIntervalMinutes: PollingIntervalMinutes): PollingSchedule | undefined {
    const row = this.#db
      .select({ lastPolledAt: subscriptions.lastPolledAt, createdAt: subscriptions.createdAt })
      .from(subscriptions)
      .where(eq(subscriptions.feedId, feedId))
      .limit(1)
      .all()[0]
    if (!row) return undefined

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
    return { pollingIntervalMinutes, nextPollAt }
  }

  /** False when there is no Subscription to change. */
  setReadingSource(feedId: number, readingSource: ReadingSource): boolean {
    const updated = this.#db.update(subscriptions).set({ readingSource }).where(eq(subscriptions.feedId, feedId)).run()
    if (updated.changes === 0) return false

    this.#logger.info('subscriptions.reading_source_changed', { feedId, readingSource })
    return true
  }

  /** Replaces both overrides; the Feed's reported title and description keep being tracked underneath. */
  setFeedDetails(feedId: number, overrides: UpdateFeedDetailsRequest): FeedDetailsUpdate | undefined {
    const row = this.#db
      .select({ reportedTitle: feeds.title, reportedDescription: feeds.description })
      .from(subscriptions)
      .innerJoin(feeds, eq(feeds.id, subscriptions.feedId))
      .where(eq(subscriptions.feedId, feedId))
      .limit(1)
      .all()[0]
    if (!row) return undefined

    const { customTitle, customDescription } = overrides
    this.#db.update(subscriptions).set({ customTitle, customDescription }).where(eq(subscriptions.feedId, feedId)).run()

    this.#logger.info('subscriptions.feed_details_changed', {
      feedId,
      customTitle: customTitle !== null,
      customDescription: customDescription !== null,
    })
    return {
      title: customTitle ?? row.reportedTitle,
      customTitle,
      description: customDescription ?? row.reportedDescription,
      customDescription,
    }
  }

  /**
   * Deletes only the Subscription row — polling and Digest membership hinge on it.
   * Retained rows wait for the retention sweep, which keeps saves and their attribution.
   * False when there was no Subscription.
   */
  unsubscribe(feedId: number): boolean {
    const deleted = this.#db.delete(subscriptions).where(eq(subscriptions.feedId, feedId)).run()
    if (deleted.changes === 0) return false
    this.#logger.info('subscriptions.unsubscribed', { feedId })
    return true
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
    const today = dateKey(this.#clock.now(), timezone)
    const dayOf = dayKeysIn(timezone)
    const days = gridDayKeys(today)
    const counts = cadenceByFeed(this.#db, timezone, days, [feedId])(feedId)
    const items = this.#db
      .select({ ...LISTED_ITEM_COLUMNS, link: feedItems.link })
      .from(feedItems)
      .leftJoin(libraryItems, eq(libraryItems.feedItemId, feedItems.id))
      .where(eq(feedItems.feedId, feedId))
      .orderBy(desc(feedItems.chronologyAt), desc(feedItems.id))
      .all()
      .map((row) => ({
        ...listedItemOf(row),
        link: row.link,
        date: dayOf(row.chronologyAt),
        displayTime: timeLabel(new Date(row.chronologyAt), timezone),
      }))

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
      schedule: { pollingIntervalMinutes: record.pollingIntervalMinutes, nextPollAt: record.nextPollAt },
      readingSource: record.readingSource,
      subscribedDate: dateKey(new Date(record.subscribedAt), timezone),
      cadence: days.map((date, index) => ({ date, count: counts[index] ?? 0 })),
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

  /**
   * An unsubscribed Feed holding a URL a new Feed would claim. Its aliases come
   * first; a duplicate whose aliases a merge moved away is still found by its
   * own URLs, which stay reserved until Retention retires the row.
   */
  #dormantFeed(requestedUrl: string, enteredUrl: string): FeedRecord | undefined {
    const unsubscribed = isNull(subscriptions.feedId)
    return (
      this.#db
        .select(FEED_RECORD_COLUMNS)
        .from(feedUrlAliases)
        .innerJoin(feeds, eq(feeds.id, feedUrlAliases.feedId))
        .leftJoin(subscriptions, eq(subscriptions.feedId, feeds.id))
        .where(and(eq(feedUrlAliases.url, requestedUrl), unsubscribed))
        .limit(1)
        .all()[0] ??
      this.#db
        .select(FEED_RECORD_COLUMNS)
        .from(feeds)
        .leftJoin(subscriptions, eq(subscriptions.feedId, feeds.id))
        .where(and(or(eq(feeds.enteredUrl, enteredUrl), eq(feeds.resolvedUrl, requestedUrl)), unsubscribed))
        .limit(1)
        .all()[0]
    )
  }

  #stripCadence(feedIds: readonly number[]): (feedId: number) => number[] {
    return stripCadenceByFeed(this.#db, this.#settings.effectiveTimezone(), this.#clock.now(), feedIds)
  }
}

/**
 * Shared by first subscription and revival: due immediately — the first retrieval
 * is scheduler work (ADR 0007) — with every preference left to the column defaults.
 */
function newSubscription(feedId: number, now: string) {
  return { feedId, nextPollAt: now, createdAt: now }
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
    readingSource: record.readingSource,
    subscribedAt: record.subscribedAt,
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
