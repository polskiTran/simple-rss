import { desc, eq, lte } from 'drizzle-orm'
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
  libraryItems,
  subscriptions,
} from '../persistence/schema.js'
import { cadenceByFeed, gridDayKeys, stripCadenceByFeed } from '../digest/cadence-window.js'
import { availabilityOf, type RecordedAvailability } from './feed-availability.js'
import { canonicalFeedUrl, recordSubscription, subscribedFeedId } from './new-subscription.js'
import { OpmlError, parseOpml, serializeOpml, type OpmlFailureCode, type OpmlFeedOutline } from './opml.js'
import { nextPollTime } from './polling-schedule.js'

export type ImportOpmlOutcome =
  | { readonly kind: 'invalid-opml'; readonly code: OpmlFailureCode }
  | {
      readonly kind: 'report'
      readonly added: number
      readonly alreadySubscribed: number
      readonly unusable: readonly string[]
    }

interface SubscribedFeedRecord extends RecordedAvailability {
  readonly feedId: number
  readonly title: string
  readonly description: string | null
  readonly domain: string
  readonly homePageUrl: string | null
  readonly enteredUrl: string
  readonly resolvedUrl: string
  readonly readingSource: ReadingSource
  readonly subscribedAt: string
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
  readingSource: subscriptions.readingSource,
  subscribedAt: subscriptions.createdAt,
}

/**
 * The User's Subscription changes — OPML Import, preferences, unsubscribing —
 * and the reads the UI is built from. Subscribing by hand and poll outcomes
 * are written by `FeedPoll`, which retrieves before it records (ADR 0012).
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
      const outcome = this.#record(outline.url, outline.title)
      if (outcome === 'recorded') added += 1
      else if (outcome === 'duplicate') alreadySubscribed += 1
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

  /** Records the Subscription without contacting the Feed (ADR 0007): unchecked and immediately due. */
  #record(enteredUrl: string, offeredTitle: string | null): 'recorded' | 'duplicate' | 'invalid-url' {
    const requestedUrl = canonicalFeedUrl(enteredUrl)
    if (!requestedUrl) return 'invalid-url'

    const now = this.#clock.now().toISOString()
    return this.#db.transaction((tx) => {
      if (subscribedFeedId(tx, requestedUrl) !== undefined) return 'duplicate'
      recordSubscription(tx, this.#logger, { enteredUrl, requestedUrl, offeredTitle, now })
      return 'recorded'
    })
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

  /** One Subscription as the Feeds list shows it; undefined when there is none. */
  summary(feedId: number): SubscriptionSummary | undefined {
    const record = this.#db
      .select(SUBSCRIBED_FEED_COLUMNS)
      .from(feeds)
      .innerJoin(subscriptions, eq(subscriptions.feedId, feeds.id))
      .where(eq(feeds.id, feedId))
      .limit(1)
      .all()[0]
    return record && summaryOf(record, this.#stripCadence([feedId]), this.#settings.effectiveTimezone())
  }

  list(): readonly SubscriptionSummary[] {
    const records = this.#subscribedFeeds()
    const cadenceOf = this.#stripCadence(records.map((record) => record.feedId))
    const timezone = this.#settings.effectiveTimezone()
    return records.map((record) => summaryOf(record, cadenceOf, timezone))
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
      availability: availabilityOf(record, timezone),
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

  #stripCadence(feedIds: readonly number[]): (feedId: number) => number[] {
    return stripCadenceByFeed(this.#db, this.#settings.effectiveTimezone(), this.#clock.now(), feedIds)
  }
}

function summaryOf(
  record: SubscribedFeedRecord,
  cadenceOf: (feedId: number) => number[],
  timezone: string,
): SubscriptionSummary {
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
    availability: availabilityOf(record, timezone),
  }
}
