import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import type { ReaderArticle, ReaderDeadlineStage } from '../../shared/api.js'
import type { Clock } from '../clock.js'
import type { LogField, LogFields, Logger } from '../logger.js'
import { elapsedMs } from '../monotonic.js'
import type { DrizzleDatabase } from '../persistence/database.js'
import { feedItems } from '../persistence/schema.js'
import type { Retrieval, RetrievalFailure, RetrievalFailureCode } from '../upstream/retrieval.js'
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

/**
 * Reader View's Original webpage: retrieves and extracts it once per Feed Item
 * however many readers wait, cools down after repeated failures, and keeps for a
 * minute an article that finished after the deadline already answered its reader.
 */
export class ReaderService {
  readonly #db: DrizzleDatabase
  readonly #clock: Clock
  readonly #retrieval: Retrieval
  readonly #extractor: ReaderExtractor
  readonly #logger: Logger
  readonly #budgetMs: number
  readonly #inFlight = new Map<number, InFlightExtraction>()
  readonly #failures = new Map<number, FailureEpisode>()
  readonly #stash = new Map<number, StashedArticle>()

  constructor(options: {
    db: DrizzleDatabase
    clock: Clock
    retrieval: Retrieval
    extractor: ReaderExtractor
    logger: Logger
    budgetMs?: number
  }) {
    this.#db = options.db
    this.#clock = options.clock
    this.#retrieval = options.retrieval
    this.#extractor = options.extractor
    this.#logger = options.logger
    this.#budgetMs = options.budgetMs ?? READER_BUDGET_MS
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
    // `reader.trace` carries the Reader's phases; the upstream phases are on
    // the `upstream.retrieval_*` record with the same `trace`.
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
      }
      if (result.code !== 'cancelled' && result.code !== 'busy') this.#recordFailure(feedItemId)
      return finish(result.code, fields, { kind: 'retrieval-failed', failure: result })
    }

    extraction.stage = 'parsing'
    const answered = hostField(result.url)
    const parsed = await this.#extractor.extract(
      { bytes: result.bytes.buffer, charset: result.charset, url: result.url },
      signal,
    )
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
}

function hostField(url: string): LogFields {
  try {
    return { host: new URL(url).host }
  } catch {
    return {}
  }
}

function definedFields(timings: ReaderExtractionTimings): LogFields {
  const fields: Record<string, LogField> = {}
  for (const [phase, value] of Object.entries(timings)) {
    if (value !== undefined) fields[phase] = value
  }
  return fields
}
