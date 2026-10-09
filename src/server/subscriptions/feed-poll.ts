import { eq } from 'drizzle-orm'
import type { ReadingSource } from '../../shared/api.js'
import type { Clock } from '../clock.js'
import { FeedDocumentError, parseFeedDocument, type ParsedFeedDocument } from '../ingestion/feed-document.js'
import { type DatabaseTransaction, persistFeedWindow } from '../ingestion/feed-window.js'
import type { Logger } from '../logger.js'
import type { DrizzleDatabase } from '../persistence/database.js'
import { feedUrlAliases, feeds, subscriptions } from '../persistence/schema.js'
import type { Retrieval, RetrievalBytes } from '../upstream/retrieval.js'
import { settle, type FailedPoll, type PolledFeed, type SettledPoll } from './feed-availability.js'
import { loggableUrl } from './loggable-url.js'

export type IngestFeedOutcome =
  | { readonly kind: 'updated'; readonly observedItems: number }
  | { readonly kind: 'not-modified' }
  | { readonly kind: 'missing' }
  /** The retrieval revealed this Feed to be another subscribed Feed (ADR 0007). */
  | { readonly kind: 'merged'; readonly intoFeedId: number }
  | FailedPoll

/** A subscribed Feed and what one attempt at it needs: its validators, its cadence, its failure run. */
interface PollableFeed extends PolledFeed {
  readonly enteredUrl: string
  readonly readingSource: ReadingSource
  readonly etag: string | null
  readonly lastModified: string | null
}

/** What the publisher said, before anything is written. */
type Answer =
  | FailedPoll
  | { readonly kind: 'not-modified'; readonly retrieved: RetrievalBytes }
  | { readonly kind: 'parsed'; readonly retrieved: RetrievalBytes; readonly parsed: ParsedFeedDocument }

/**
 * One retrieval of one Feed, end to end: the conditional request, the parse,
 * then every write the answer earns in one transaction — the Feed Window, a
 * merge the retrieval revealed (ADR 0007), and the Feed Availability that
 * `settle` decides. Poll outcomes are written here and nowhere else.
 */
export class FeedPoll {
  readonly #db: DrizzleDatabase
  readonly #retrieval: Retrieval
  readonly #clock: Clock
  readonly #logger: Logger

  constructor(options: { db: DrizzleDatabase; retrieval: Retrieval; clock: Clock; logger: Logger }) {
    this.#db = options.db
    this.#retrieval = options.retrieval
    this.#clock = options.clock
    this.#logger = options.logger.child({ component: 'subscriptions' })
  }

  async ingest(feedId: number): Promise<IngestFeedOutcome> {
    const feed = this.#pollableFeed(feedId)
    if (!feed) return { kind: 'missing' }

    const answer = await this.#ask(feed)
    const now = this.#clock.now()
    return this.#db.transaction((tx) => this.#record(tx, feed, answer, now))
  }

  async #ask(feed: PollableFeed): Promise<Answer> {
    const retrieved = await this.#retrieval.retrieveBytes({
      url: feed.resolvedUrl,
      operation: 'feed',
      conditional: { etag: feed.etag, lastModified: feed.lastModified },
    })
    if (!retrieved.ok) return { kind: 'retrieval-failed', failure: retrieved }
    if (retrieved.notModified) return { kind: 'not-modified', retrieved }

    try {
      const parsed = parseFeedDocument(retrieved.bytes, retrieved.url, [feed.enteredUrl, feed.resolvedUrl])
      return { kind: 'parsed', retrieved, parsed }
    } catch (error) {
      if (error instanceof FeedDocumentError) return { kind: 'invalid-feed', code: error.code }
      throw error
    }
  }

  /**
   * Writes nothing when the Subscription is gone by the time the answer lands:
   * unsubscribing takes effect immediately, and an in-flight poll must not
   * resurrect what the User let go of.
   */
  #record(tx: DatabaseTransaction, feed: PollableFeed, answer: Answer, now: Date): IngestFeedOutcome {
    const subscribed = tx
      .select({ feedId: subscriptions.feedId })
      .from(subscriptions)
      .where(eq(subscriptions.feedId, feed.feedId))
      .limit(1)
      .all()[0]
    if (!subscribed) return { kind: 'missing' }

    if (answer.kind === 'not-modified') {
      // A 304 may still rotate the validators; keeping the newest ones keeps
      // later requests conditional. No Feed Item row is touched.
      tx.update(feeds)
        .set({
          etag: answer.retrieved.etag ?? feed.etag,
          lastModified: answer.retrieved.lastModified ?? feed.lastModified,
        })
        .where(eq(feeds.id, feed.feedId))
        .run()
      this.#settle(tx, feed, answer, now)
      this.#logger.info('subscriptions.feed_unchanged', {
        feedId: feed.feedId,
        resolvedUrl: loggableUrl(feed.resolvedUrl),
      })
      return { kind: 'not-modified' }
    }

    if (answer.kind !== 'parsed') {
      this.#settle(tx, feed, answer, now)
      return answer
    }

    const { retrieved, parsed } = answer
    const window = {
      parsed,
      resolvedUrl: retrieved.url,
      validators: { etag: retrieved.etag, lastModified: retrieved.lastModified },
      now: now.toISOString(),
    }

    // Two entered URLs can hide one Feed; the retrieval is what reveals it.
    // The later Subscription folds into the existing Feed (ADR 0007).
    const existingFeedId = aliasOwner(tx, retrieved.url)
    if (existingFeedId !== undefined && existingFeedId !== feed.feedId) {
      const survivor = this.#mergeInto(tx, feed, existingFeedId, retrieved.url, now)
      persistFeedWindow(tx, { feedId: survivor.feedId, ...window })
      this.#settle(tx, survivor, { kind: 'updated' }, now)
      return { kind: 'merged', intoFeedId: existingFeedId }
    }

    persistFeedWindow(tx, { feedId: feed.feedId, ...window })
    this.#settle(tx, feed, { kind: 'updated' }, now)
    const observedItems = new Set(parsed.items.map((item) => item.dedupeKey)).size
    this.#logger.info('subscriptions.feed_window_ingested', {
      feedId: feed.feedId,
      enteredUrl: loggableUrl(feed.enteredUrl),
      resolvedUrl: loggableUrl(retrieved.url),
      observedItems,
    })
    return { kind: 'updated', observedItems }
  }

  #settle(tx: DatabaseTransaction, feed: PolledFeed, outcome: SettledPoll, now: Date): void {
    const { patch, log } = settle(feed, outcome, now)
    tx.update(subscriptions).set(patch).where(eq(subscriptions.feedId, feed.feedId)).run()
    if (log) this.#logger[log.level](log.message, log.fields)
  }

  /**
   * Folds the duplicate's Subscription into the existing Feed: the URLs move,
   * the duplicate's Subscription goes, and its Feed row is left for Retention
   * to judge like any unsubscribed Feed. An unsubscribed survivor is revived
   * with the duplicate's preferences. Returns the survivor as the poll settles it.
   */
  #mergeInto(
    tx: DatabaseTransaction,
    duplicate: PollableFeed,
    existingFeedId: number,
    resolvedUrl: string,
    now: Date,
  ): PolledFeed {
    const existing = tx
      .select({
        pollingIntervalMinutes: subscriptions.pollingIntervalMinutes,
        consecutiveFailures: subscriptions.consecutiveFailures,
      })
      .from(subscriptions)
      .where(eq(subscriptions.feedId, existingFeedId))
      .limit(1)
      .all()[0]
    tx.delete(subscriptions).where(eq(subscriptions.feedId, duplicate.feedId)).run()
    tx.update(feedUrlAliases).set({ feedId: existingFeedId }).where(eq(feedUrlAliases.feedId, duplicate.feedId)).run()

    if (!existing) {
      tx.insert(subscriptions)
        .values({
          feedId: existingFeedId,
          pollingIntervalMinutes: duplicate.pollingIntervalMinutes,
          readingSource: duplicate.readingSource,
          nextPollAt: now.toISOString(),
          createdAt: now.toISOString(),
        })
        .run()
    }

    this.#logger.info('subscriptions.feeds_merged', { feedId: duplicate.feedId, intoFeedId: existingFeedId })
    return {
      feedId: existingFeedId,
      resolvedUrl,
      pollingIntervalMinutes: existing?.pollingIntervalMinutes ?? duplicate.pollingIntervalMinutes,
      consecutiveFailures: existing?.consecutiveFailures ?? 0,
    }
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
        readingSource: subscriptions.readingSource,
      })
      .from(feeds)
      .innerJoin(subscriptions, eq(subscriptions.feedId, feeds.id))
      .where(eq(feeds.id, feedId))
      .limit(1)
      .all()[0]
  }
}

function aliasOwner(tx: DatabaseTransaction, url: string): number | undefined {
  return tx
    .select({ feedId: feedUrlAliases.feedId })
    .from(feedUrlAliases)
    .where(eq(feedUrlAliases.url, url))
    .limit(1)
    .all()[0]?.feedId
}
