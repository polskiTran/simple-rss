import { eq } from 'drizzle-orm'
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import type { ReaderArticle, ReaderItem } from '../../shared/api.js'
import type { Clock } from '../clock.js'
import { chronologyTime, dateKey, readerDate } from '../digest/chronology.js'
import type { DigestService } from '../digest/digest-service.js'
import type { SqliteDatabase } from '../persistence/database.js'
import type { InstallationSettingsStore } from '../persistence/installation-settings.js'
import { feedItems, feeds, libraryItems } from '../persistence/schema.js'
import type { Retrieval, RetrievalFailure } from '../upstream/retrieval.js'
import { extractArticle } from './extract-article.js'

/**
 * How long a failed parse blocks the next deliberate retry. Long enough that
 * a stuck publisher is not hammered, short enough that "try again" is a real
 * offer rather than a scolding.
 */
const RETRY_COOLDOWN_MS = 30_000

export type ReaderArticleOutcome =
  | { readonly kind: 'missing' }
  | { readonly kind: 'no-link' }
  | { readonly kind: 'rate-limited'; readonly retryAfterSeconds: number }
  | { readonly kind: 'retrieval-failed'; readonly failure: RetrievalFailure }
  /** The page arrived but yielded no readable article. */
  | { readonly kind: 'unreadable' }
  | { readonly kind: 'extracted'; readonly article: ReaderArticle }

/**
 * Reader View: a temporary rendering derived on demand from a persisted Feed
 * Item's original link — never from a caller-supplied URL, and never written
 * back to the database. A failure here leaves the Feed Item, its summary, and
 * its Library membership exactly as they were.
 */
export class ReaderService {
  readonly #db: BetterSQLite3Database
  readonly #clock: Clock
  readonly #settings: InstallationSettingsStore
  readonly #retrieval: Retrieval
  readonly #digest: DigestService
  readonly #inFlight = new Map<number, Promise<ReaderArticleOutcome>>()
  readonly #lastFailureAt = new Map<number, number>()

  constructor(options: {
    database: SqliteDatabase
    clock: Clock
    settings: InstallationSettingsStore
    retrieval: Retrieval
    digest: DigestService
  }) {
    this.#db = drizzle(options.database)
    this.#clock = options.clock
    this.#settings = options.settings
    this.#retrieval = options.retrieval
    this.#digest = options.digest
  }

  /** The header, fallback summary, and onward path for one Feed Item. */
  item(feedItemId: number): ReaderItem | undefined {
    const row = this.#db
      .select({
        feedItemId: feedItems.id,
        title: feedItems.title,
        feedId: feeds.id,
        feedTitle: feeds.title,
        link: feedItems.link,
        publishedAt: feedItems.publishedAt,
        summary: feedItems.summary,
        firstSeenAt: feedItems.firstSeenAt,
        savedAt: libraryItems.savedAt,
      })
      .from(feedItems)
      .innerJoin(feeds, eq(feeds.id, feedItems.feedId))
      .leftJoin(libraryItems, eq(libraryItems.feedItemId, feedItems.id))
      .where(eq(feedItems.id, feedItemId))
      .limit(1)
      .all()[0]
    if (!row) return undefined

    const timezone = this.#settings.effectiveTimezone()
    const now = this.#clock.now()
    const instant = new Date(chronologyTime(row.publishedAt, row.firstSeenAt, now))

    return {
      feedItemId: row.feedItemId,
      title: row.title ?? 'untitled',
      feedId: row.feedId,
      feedTitle: row.feedTitle,
      link: row.link,
      publishedAt: row.publishedAt,
      firstSeenAt: row.firstSeenAt,
      displayDate: readerDate(instant, dateKey(now, timezone), timezone),
      summary: row.summary,
      saved: row.savedAt !== null,
      nextInDigest: this.#nextInDigest(feedItemId),
    }
  }

  /**
   * The extraction itself. Concurrent readers of the same item share one
   * retrieval, and a failed parse starts the retry cooldown — success costs
   * nothing, because the browser holds it privately for a day.
   */
  async article(feedItemId: number): Promise<ReaderArticleOutcome> {
    const row = this.#db
      .select({ link: feedItems.link })
      .from(feedItems)
      .where(eq(feedItems.id, feedItemId))
      .limit(1)
      .all()[0]
    if (!row) return { kind: 'missing' }
    const link = row.link
    if (!link) return { kind: 'no-link' }

    const inFlight = this.#inFlight.get(feedItemId)
    if (inFlight) return inFlight

    const now = this.#clock.now().getTime()
    for (const [id, failedAt] of this.#lastFailureAt) {
      if (now - failedAt >= RETRY_COOLDOWN_MS) this.#lastFailureAt.delete(id)
    }
    const failedAt = this.#lastFailureAt.get(feedItemId)
    if (failedAt !== undefined) {
      return {
        kind: 'rate-limited',
        retryAfterSeconds: Math.ceil((RETRY_COOLDOWN_MS - (now - failedAt)) / 1_000),
      }
    }

    const work = this.#extract(feedItemId, link).finally(() => this.#inFlight.delete(feedItemId))
    this.#inFlight.set(feedItemId, work)
    return work
  }

  async #extract(feedItemId: number, link: string): Promise<ReaderArticleOutcome> {
    const result = await this.#retrieval.retrieveBytes({ url: link, operation: 'reader' })
    if (!result.ok) {
      this.#lastFailureAt.set(feedItemId, this.#clock.now().getTime())
      return { kind: 'retrieval-failed', failure: result }
    }

    const extracted = await extractArticle({ bytes: result.bytes, charset: result.charset, url: result.url })
    if (!extracted) {
      this.#lastFailureAt.set(feedItemId, this.#clock.now().getTime())
      return { kind: 'unreadable' }
    }

    return { kind: 'extracted', article: { feedItemId, ...extracted } }
  }

  /**
   * What follows this item in the Digest, read from the Digest itself so the
   * two can never disagree about the order.
   */
  #nextInDigest(feedItemId: number): ReaderItem['nextInDigest'] {
    const ordered = this.#digest.read().groups.flatMap((group) => group.items)
    const index = ordered.findIndex((entry) => entry.feedItemId === feedItemId)
    const next = index === -1 ? undefined : ordered[index + 1]
    if (!next) return null
    return {
      feedItemId: next.feedItemId,
      title: next.title,
      feedTitle: next.feedTitle,
      displayTime: next.displayTime,
    }
  }
}
