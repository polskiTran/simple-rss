import { eq } from 'drizzle-orm'
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import type { ReaderArticle, ReaderItem } from '../../shared/api.js'
import type { Clock } from '../clock.js'
import { chronologyTime, dateKey, readerDate } from '../digest/chronology.js'
import type { DigestService } from '../digest/digest-service.js'
import type { SqliteDatabase } from '../persistence/database.js'
import type { SignImageUrl } from '../images/image-url-signature.js'
import type { InstallationSettingsStore } from '../persistence/installation-settings.js'
import { feedItems, feeds, libraryItems } from '../persistence/schema.js'
import type { Retrieval, RetrievalFailure } from '../upstream/retrieval.js'
import { extractArticle } from './extract-article.js'

/**
 * How long a failing Feed Item's parse attempts stay rate-limited. Each
 * failure episode affords the automatic attempt plus one deliberate retry —
 * the fallback offers `retry parsing`, so that offer must be honest — and
 * further attempts wait out the cooldown, so a stuck publisher is never
 * hammered.
 */
const RETRY_COOLDOWN_MS = 30_000

/** Attempts a failure episode allows before the cooldown starts refusing. */
const ATTEMPTS_BEFORE_COOLDOWN = 2

interface FailureEpisode {
  readonly attempts: number
  readonly lastAttemptAt: number
}

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
  readonly #signImageUrl: SignImageUrl
  readonly #inFlight = new Map<number, Promise<ReaderArticleOutcome>>()
  readonly #failures = new Map<number, FailureEpisode>()

  constructor(options: {
    database: SqliteDatabase
    clock: Clock
    settings: InstallationSettingsStore
    retrieval: Retrieval
    digest: DigestService
    signImageUrl: SignImageUrl
  }) {
    this.#db = drizzle(options.database)
    this.#clock = options.clock
    this.#settings = options.settings
    this.#retrieval = options.retrieval
    this.#digest = options.digest
    this.#signImageUrl = options.signImageUrl
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

    // An elapsed cooldown ends the episode entirely, so a later failure
    // affords its automatic attempt and one honest retry again.
    const now = this.#clock.now().getTime()
    for (const [id, episode] of this.#failures) {
      if (now - episode.lastAttemptAt >= RETRY_COOLDOWN_MS) this.#failures.delete(id)
    }
    const episode = this.#failures.get(feedItemId)
    if (episode && episode.attempts >= ATTEMPTS_BEFORE_COOLDOWN) {
      return {
        kind: 'rate-limited',
        retryAfterSeconds: Math.ceil((RETRY_COOLDOWN_MS - (now - episode.lastAttemptAt)) / 1_000),
      }
    }

    const work = this.#extract(feedItemId, link).finally(() => this.#inFlight.delete(feedItemId))
    this.#inFlight.set(feedItemId, work)
    return work
  }

  async #extract(feedItemId: number, link: string): Promise<ReaderArticleOutcome> {
    const result = await this.#retrieval.retrieveBytes({ url: link, operation: 'reader' })
    if (!result.ok) {
      this.#recordFailure(feedItemId)
      return { kind: 'retrieval-failed', failure: result }
    }

    const extracted = await extractArticle({
      bytes: result.bytes,
      charset: result.charset,
      url: result.url,
      signImageUrl: this.#signImageUrl,
    })
    if (!extracted) {
      this.#recordFailure(feedItemId)
      return { kind: 'unreadable' }
    }

    this.#failures.delete(feedItemId)
    return {
      kind: 'extracted',
      article: {
        feedItemId,
        markdown: extracted.markdown,
        readingTimeMinutes: extracted.readingTimeMinutes,
      },
    }
  }

  #recordFailure(feedItemId: number): void {
    this.#failures.set(feedItemId, {
      attempts: (this.#failures.get(feedItemId)?.attempts ?? 0) + 1,
      lastAttemptAt: this.#clock.now().getTime(),
    })
  }

  /** What follows this item, as the Digest itself orders it. */
  #nextInDigest(feedItemId: number): ReaderItem['nextInDigest'] {
    const next = this.#digest.after(feedItemId)
    if (!next) return null
    return {
      feedItemId: next.feedItemId,
      title: next.title,
      feedTitle: next.feedTitle,
      displayTime: next.displayTime,
    }
  }
}
