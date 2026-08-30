import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import type { ReaderArticle, ReaderDeadlineStage, ReaderItem } from '../../shared/api.js'
import type { Clock } from '../clock.js'
import { chronologyTime, dateKey, readerDate } from '../digest/chronology.js'
import type { DigestService } from '../digest/digest-service.js'
import type { LogField, LogFields, Logger } from '../logger.js'
import { elapsedMs } from '../monotonic.js'
import type { DrizzleDatabase } from '../persistence/database.js'
import type { InstallationSettingsStore } from '../persistence/installation-settings.js'
import { effectiveFeedTitle, feedItems, feeds, libraryItems, subscriptions } from '../persistence/schema.js'
import type { Retrieval, RetrievalFailure, RetrievalFailureCode, RetrievalTimings } from '../upstream/retrieval.js'
import type { ReaderExtractionTimings, ReaderExtractor } from './reader-extractor.js'

type ReaderTraceOutcome = RetrievalFailureCode | 'extracted' | 'unreadable' | 'worker_failed'

const READER_USER_BOUNDARY_MS = 5_000

const READER_RESPONSE_AND_RENDER_MS = 500

const READER_BUDGET_MS = READER_USER_BOUNDARY_MS - READER_RESPONSE_AND_RENDER_MS

const RETRY_COOLDOWN_MS = 30_000

const ATTEMPTS_BEFORE_COOLDOWN = 5

const STASH_TTL_MS = 60_000

interface FailureEpisode {
  readonly attempts: number
  readonly lastAttemptAt: number
}

interface StashedArticle {
  readonly article: ReaderArticle
  readonly expiresAt: number
}

export type ReaderArticleOutcome =
  | { readonly kind: 'missing' }
  | { readonly kind: 'no-link' }
  | { readonly kind: 'rate-limited'; readonly retryAfterSeconds: number }
  | { readonly kind: 'retrieval-failed'; readonly failure: RetrievalFailure }
  | { readonly kind: 'unreadable' }
  | { readonly kind: 'deadline'; readonly stage: ReaderDeadlineStage }
  | { readonly kind: 'extracted'; readonly article: ReaderArticle }

class InFlightExtraction {
  readonly controller = new AbortController()
  readonly work: Promise<ReaderArticleOutcome>
  waiters = 0
  stage: ReaderDeadlineStage = 'publisher'
  survivesAbandonment = false

  constructor(start: (extraction: InFlightExtraction) => Promise<ReaderArticleOutcome>) {
    this.work = start(this)
  }
}

const ABANDONED_READER_OUTCOME = {
  kind: 'retrieval-failed',
  failure: { ok: false, code: 'cancelled', reason: 'the browser left the Reader' },
} satisfies ReaderArticleOutcome

export class ReaderService {
  readonly #db: DrizzleDatabase
  readonly #clock: Clock
  readonly #settings: InstallationSettingsStore
  readonly #retrieval: Retrieval
  readonly #digest: DigestService
  readonly #extractor: ReaderExtractor
  readonly #logger: Logger
  readonly #budgetMs: number
  readonly #inFlight = new Map<number, InFlightExtraction>()
  readonly #failures = new Map<number, FailureEpisode>()
  readonly #stash = new Map<number, StashedArticle>()

  constructor(options: {
    db: DrizzleDatabase
    clock: Clock
    settings: InstallationSettingsStore
    retrieval: Retrieval
    digest: DigestService
    extractor: ReaderExtractor
    logger: Logger
    budgetMs?: number
  }) {
    this.#db = options.db
    this.#clock = options.clock
    this.#settings = options.settings
    this.#retrieval = options.retrieval
    this.#digest = options.digest
    this.#extractor = options.extractor
    this.#logger = options.logger
    this.#budgetMs = options.budgetMs ?? READER_BUDGET_MS
  }

  item(feedItemId: number): ReaderItem | undefined {
    const row = this.#db
      .select({
        feedItemId: feedItems.id,
        title: feedItems.title,
        feedId: feeds.id,
        feedTitle: effectiveFeedTitle,
        link: feedItems.link,
        publishedAt: feedItems.publishedAt,
        summary: feedItems.summary,
        firstSeenAt: feedItems.firstSeenAt,
        savedAt: libraryItems.savedAt,
      })
      .from(feedItems)
      .innerJoin(feeds, eq(feeds.id, feedItems.feedId))
      .leftJoin(subscriptions, eq(subscriptions.feedId, feeds.id))
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

  async article(feedItemId: number, signal?: AbortSignal): Promise<ReaderArticleOutcome> {
    const row = this.#db
      .select({ link: feedItems.link })
      .from(feedItems)
      .where(eq(feedItems.id, feedItemId))
      .limit(1)
      .all()[0]
    if (!row) return { kind: 'missing' }
    const link = row.link
    if (!link) return { kind: 'no-link' }

    this.#sweepStash()
    const stashed = this.#stash.get(feedItemId)?.article
    if (stashed) return { kind: 'extracted', article: stashed }

    const inFlight = this.#inFlight.get(feedItemId)
    if (inFlight) return this.#waitForExtraction(feedItemId, inFlight, signal)

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

    const extraction = new InFlightExtraction((created) => this.#extract(feedItemId, link, created))
    this.#inFlight.set(feedItemId, extraction)
    const finish = () => {
      if (this.#inFlight.get(feedItemId) === extraction) this.#inFlight.delete(feedItemId)
    }
    void extraction.work.then(finish, finish)
    return this.#waitForExtraction(feedItemId, extraction, signal)
  }

  async close(): Promise<void> {
    for (const extraction of this.#inFlight.values()) extraction.controller.abort()
    this.#inFlight.clear()
    await this.#extractor.close()
  }

  async #extract(feedItemId: number, link: string, extraction: InFlightExtraction): Promise<ReaderArticleOutcome> {
    const trace = randomUUID()
    const signal = extraction.controller.signal
    const startedAt = performance.now()
    const finish = <Outcome extends ReaderArticleOutcome>(
      outcome: ReaderTraceOutcome,
      fields: Readonly<Record<string, LogField>>,
      value: Outcome,
    ): Outcome => {
      const level = outcome === 'extracted' || outcome === 'cancelled' ? 'debug' : 'warn'
      this.#logger[level]('reader.trace', {
        trace,
        feedItemId,
        outcome,
        ...fields,
        totalMs: elapsedMs(startedAt),
      })
      return value
    }

    const result = await this.#retrieval.retrieveBytes({ url: link, operation: 'reader', signal, trace })
    if (!result.ok) {
      const fields = {
        ...hostField(link),
        ...(result.status === undefined ? {} : { status: result.status }),
        ...definedFields(result.timings),
      }
      if (result.code !== 'cancelled' && result.code !== 'busy') this.#recordFailure(feedItemId)
      return finish(result.code, fields, { kind: 'retrieval-failed', failure: result })
    }

    extraction.stage = 'parsing'
    const answered = { ...hostField(result.url), ...definedFields(result.timings) }
    const bytes = ownedArrayBuffer(result.bytes)
    const parsed = await this.#extractor.extract({ bytes, charset: result.charset, url: result.url }, signal)
    if (parsed.kind === 'cancelled') {
      return finish('cancelled', answered, ABANDONED_READER_OUTCOME)
    }
    if (parsed.kind === 'failed') {
      this.#recordFailure(feedItemId)
      return finish('worker_failed', answered, { kind: 'unreadable' })
    }
    if (parsed.kind !== 'extracted') {
      this.#recordFailure(feedItemId)
      return finish('unreadable', { ...answered, ...definedFields(parsed.timings) }, { kind: 'unreadable' })
    }

    this.#failures.delete(feedItemId)
    const article: ReaderArticle = {
      feedItemId,
      markdown: parsed.article.markdown,
      readingTimeMinutes: parsed.article.readingTimeMinutes,
    }
    if (extraction.survivesAbandonment) {
      this.#stash.set(feedItemId, { article, expiresAt: this.#clock.now().getTime() + STASH_TTL_MS })
    }
    return finish('extracted', { ...answered, ...definedFields(parsed.timings) }, { kind: 'extracted', article })
  }

  async #waitForExtraction(
    feedItemId: number,
    extraction: InFlightExtraction,
    signal: AbortSignal | undefined,
  ): Promise<ReaderArticleOutcome> {
    extraction.waiters += 1
    const release = () => {
      extraction.waiters -= 1
      if (extraction.waiters > 0 || extraction.survivesAbandonment) return
      if (this.#inFlight.get(feedItemId) === extraction) {
        this.#inFlight.delete(feedItemId)
        extraction.controller.abort()
      }
    }

    if (signal?.aborted) {
      release()
      return ABANDONED_READER_OUTCOME
    }

    const answered = Promise.withResolvers<ReaderArticleOutcome>()
    const budget = setTimeout(() => {
      extraction.survivesAbandonment = true
      this.#logger.warn('reader.deadline', { feedItemId, stage: extraction.stage })
      answered.resolve({ kind: 'deadline', stage: extraction.stage })
    }, this.#budgetMs)
    const onAbort = () => answered.resolve(ABANDONED_READER_OUTCOME)
    signal?.addEventListener('abort', onAbort, { once: true })
    try {
      return await Promise.race([extraction.work, answered.promise])
    } finally {
      clearTimeout(budget)
      signal?.removeEventListener('abort', onAbort)
      release()
    }
  }

  #sweepStash(): void {
    const now = this.#clock.now().getTime()
    for (const [id, entry] of this.#stash) {
      if (entry.expiresAt <= now) this.#stash.delete(id)
    }
  }

  #recordFailure(feedItemId: number): void {
    this.#failures.set(feedItemId, {
      attempts: (this.#failures.get(feedItemId)?.attempts ?? 0) + 1,
      lastAttemptAt: this.#clock.now().getTime(),
    })
  }

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

function hostField(url: string): LogFields {
  try {
    return { host: new URL(url).host }
  } catch {
    return {}
  }
}

function definedFields(timings: RetrievalTimings | ReaderExtractionTimings | undefined): LogFields {
  if (!timings) return {}
  const fields: Record<string, LogField> = {}
  for (const [phase, value] of Object.entries(timings)) {
    if (value !== undefined) fields[phase] = value
  }
  return fields
}

/**
 * The extractor transfers this buffer to the worker, which detaches every view
 * onto it, so the article has to be the buffer's only occupant.
 */
function ownedArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const owned =
    bytes.buffer instanceof ArrayBuffer && bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength
  // `bytes.slice()` will not do. On a Node Buffer it aliases `subarray` and
  // returns a view onto the very pool this is meant to escape.
  return owned ? bytes.buffer : new Uint8Array(bytes).buffer
}
