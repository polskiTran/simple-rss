import { eq } from 'drizzle-orm'
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import type { Clock } from '../clock.js'
import type { ParsedFeedDocument } from '../ingestion/feed-document.js'
import { observedItemCount, persistFeedWindow } from '../ingestion/feed-window.js'
import type { Logger } from '../logger.js'
import type { SqliteDatabase } from '../persistence/database.js'
import { feedUrlAliases, feeds, subscriptions } from '../persistence/schema.js'
import type { Retrieval, RetrievalBytes } from '../upstream/retrieval.js'
import {
  availabilityCategoryOf,
  wasNeverAsked,
  type FailedPoll,
  type FeedAvailability,
  type PolledFeed,
} from './feed-availability.js'
import { loggableUrl } from './loggable-url.js'
import { type FeedValidators, proveFeed } from './prove-feed.js'
import type { SubscriptionService } from './subscription-service.js'

export type IngestFeedOutcome =
  | { readonly kind: 'updated'; readonly observedItems: number }
  | { readonly kind: 'not-modified' }
  | { readonly kind: 'missing' }
  /** The retrieval revealed this Feed to be another subscribed Feed: the quiet merge, which only an imported Subscription reaches (ADR 0009). */
  | { readonly kind: 'merged'; readonly intoFeedId: number }
  | FailedPoll

/** A subscribed Feed and what one attempt at it needs: its validators, its cadence, its failure run. */
interface PollableFeed extends PolledFeed, FeedValidators {
  readonly enteredUrl: string
}

/**
 * One poll of one Feed, end to end: the conditional retrieval and parse
 * (`proveFeed`), the Feed Window write, and the single Feed Availability write
 * the outcome earns. A retrieval that reveals a duplicate is handed back to
 * `SubscriptionService`, which owns every Subscription write (ADR 0009).
 */
export class FeedPoll {
  readonly #db: BetterSQLite3Database
  readonly #retrieval: Retrieval
  readonly #clock: Clock
  readonly #logger: Logger
  readonly #subscriptions: Pick<SubscriptionService, 'mergeInto'>
  readonly #availability: FeedAvailability

  constructor(options: {
    database: SqliteDatabase
    retrieval: Retrieval
    clock: Clock
    logger: Logger
    subscriptions: Pick<SubscriptionService, 'mergeInto'>
    availability: FeedAvailability
  }) {
    this.#db = drizzle(options.database)
    this.#retrieval = options.retrieval
    this.#clock = options.clock
    this.#logger = options.logger.child({ component: 'subscriptions' })
    this.#subscriptions = options.subscriptions
    this.#availability = options.availability
  }

  async ingest(feedId: number): Promise<IngestFeedOutcome> {
    const feed = this.#pollableFeed(feedId)
    if (!feed) return { kind: 'missing' }

    const outcome = await this.#poll(feed)
    if (outcome.kind === 'missing' || outcome.kind === 'merged') return outcome
    if (outcome.kind === 'updated' || outcome.kind === 'not-modified') this.#availability.recordSuccess(feed)
    else if (wasNeverAsked(outcome)) this.#availability.recordDeferral(feed, outcome.failure.code)
    else this.#availability.recordFailure(feed, availabilityCategoryOf(outcome))
    return outcome
  }

  async #poll(feed: PollableFeed): Promise<IngestFeedOutcome> {
    const proof = await proveFeed({
      retrieval: this.#retrieval,
      url: feed.resolvedUrl,
      operation: 'feed',
      validators: { etag: feed.etag, lastModified: feed.lastModified },
      priorUrls: [feed.enteredUrl],
    })

    if (proof.kind === 'not-modified') {
      // A 304 may still rotate the validators; keeping the newest ones keeps
      // later requests conditional. No Feed Item row is touched.
      this.#db.update(feeds).set(proof.validators).where(eq(feeds.id, feed.feedId)).run()
      this.#logger.info('subscriptions.feed_unchanged', {
        feedId: feed.feedId,
        resolvedUrl: loggableUrl(feed.resolvedUrl),
      })
      return { kind: 'not-modified' }
    }
    if (proof.kind !== 'proven') return proof
    const { retrieved, parsed } = proof

    // Two entered URLs can hide one Feed; the later Subscription folds into the existing Feed (ADR 0009).
    const existingFeedId = this.#aliasOwner(retrieved.url)
    if (existingFeedId !== undefined && existingFeedId !== feed.feedId) {
      this.#subscriptions.mergeInto(feed, existingFeedId)
      const survivor = this.#pollableFeed(existingFeedId)
      // The Feed Window just retrieved belongs to the survivor, and reaching it
      // is the success the survivor's own schedule should count.
      if (survivor) {
        this.#write(survivor.feedId, parsed, retrieved)
        this.#availability.recordSuccess(survivor)
      }
      return { kind: 'merged', intoFeedId: existingFeedId }
    }

    if (!this.#write(feed.feedId, parsed, retrieved)) return { kind: 'missing' }
    const observedItems = observedItemCount(parsed)
    this.#logger.info('subscriptions.feed_window_ingested', {
      feedId: feed.feedId,
      enteredUrl: loggableUrl(feed.enteredUrl),
      resolvedUrl: loggableUrl(retrieved.url),
      observedItems,
    })
    return { kind: 'updated', observedItems }
  }

  /** False when the Subscription vanished mid-flight, which is the one way a write finds nothing to write to. */
  #write(feedId: number, parsed: ParsedFeedDocument, retrieved: RetrievalBytes): boolean {
    return persistFeedWindow(this.#db, {
      feedId,
      parsed,
      resolvedUrl: retrieved.url,
      validators: { etag: retrieved.etag ?? null, lastModified: retrieved.lastModified ?? null },
      now: this.#clock.now().toISOString(),
    })
  }

  #aliasOwner(url: string): number | undefined {
    return this.#db
      .select({ feedId: feedUrlAliases.feedId })
      .from(feedUrlAliases)
      .where(eq(feedUrlAliases.url, url))
      .limit(1)
      .all()[0]?.feedId
  }

  #pollableFeed(feedId: number): PollableFeed | undefined {
    return this.#db
      .select({
        feedId: feeds.id,
        enteredUrl: feeds.enteredUrl,
        resolvedUrl: feeds.resolvedUrl,
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
}
