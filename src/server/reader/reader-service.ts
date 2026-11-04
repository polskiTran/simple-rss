import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import type { ReaderArticle, ReaderDeadlineStage } from '../../shared/api.js'
import type { Clock } from '../clock.js'
import type { LogFields, Logger } from '../logger.js'
import { elapsedMs } from '../monotonic.js'
import type { DrizzleDatabase } from '../persistence/database.js'
import { feedItems } from '../persistence/schema.js'
import type { Retrieval, RetrievalFailure, RetrievalFailureCode } from '../upstream/retrieval.js'
import type { ReaderExtractor } from './reader-extractor.js'

type ReaderTraceOutcome = RetrievalFailureCode | 'extracted' | 'unreadable' | 'worker_failed'

const READER_USER_BOUNDARY_MS = 5_000

const READER_RESPONSE_AND_RENDER_MS = 500

const READER_BUDGET_MS = READER_USER_BOUNDARY_MS - READER_RESPONSE_AND_RENDER_MS

const RETRY_COOLDOWN_MS = 30_000

const ATTEMPTS_BEFORE_COOLDOWN = 5

const STASH_TTL_MS = 60_000

/** Failed attempts on one Feed Item, the latest within `RETRY_COOLDOWN_MS` of the one before. */
interface FailureEpisode {
  readonly attempts: number
  readonly lastAttemptAt: number
}

export type ReaderArticleOutcome =
  | { readonly kind: 'missing' }
  | { readonly kind: 'no-link' }
  | { readonly kind: 'rate-limited'; readonly retryAfterSeconds: number }
  | { readonly kind: 'retrieval-failed'; readonly failure: RetrievalFailure }
  | { readonly kind: 'unreadable' }
  | { readonly kind: 'deadline'; readonly stage: ReaderDeadlineStage }
  | { readonly kind: 'extracted'; readonly article: ReaderArticle }

/**
 * One retrieval and extraction, shared by every reader waiting on its Feed Item.
 * `episode` is the failure run it started under, so its own failure extends it.
 * `pastDeadline` turns true once a deadline answered a reader: from then the work
 * runs on without readers, and its article is stashed for the refetch.
 */
class Extraction {
  readonly controller = new AbortController()
  readonly work: Promise<ReaderArticleOutcome>
  waiters = 0
  stage: ReaderDeadlineStage = 'publisher'
  pastDeadline = false

  constructor(
    readonly episode: FailureEpisode | undefined,
    start: (extraction: Extraction) => Promise<ReaderArticleOutcome>,
  ) {
    this.work = start(this)
  }
}

/** Where one Feed Item's Original webpage stands; a Feed Item with no entry has nothing pending. */
type ReaderEntry =
  | { readonly kind: 'extracting'; readonly extraction: Extraction }
  | { readonly kind: 'stashed'; readonly article: ReaderArticle; readonly expiresAt: number }
  | ({ readonly kind: 'failing' } & FailureEpisode)

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
  readonly #entries = new Map<number, ReaderEntry>()

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

    const now = this.#clock.now().getTime()
    this.#sweep(now)
    const entry = this.#entries.get(feedItemId)
    if (entry?.kind === 'stashed') return { kind: 'extracted', article: entry.article }
    if (entry?.kind === 'extracting') return this.#waitForExtraction(feedItemId, entry.extraction, signal)
    if (entry?.kind === 'failing' && entry.attempts >= ATTEMPTS_BEFORE_COOLDOWN) {
      return {
        kind: 'rate-limited',
        retryAfterSeconds: Math.ceil((RETRY_COOLDOWN_MS - (now - entry.lastAttemptAt)) / 1_000),
      }
    }

    const extraction = new Extraction(entry, (created) => this.#extract(feedItemId, link, created))
    this.#entries.set(feedItemId, { kind: 'extracting', extraction })
    const finish = (outcome?: ReaderArticleOutcome) => {
      if (!this.#isExtracting(feedItemId, extraction)) return
      this.#become(feedItemId, settled(extraction, outcome, this.#clock.now().getTime()))
    }
    void extraction.work.then(finish, () => finish())
    return this.#waitForExtraction(feedItemId, extraction, signal)
  }

  async close(): Promise<void> {
    for (const entry of this.#entries.values()) {
      if (entry.kind === 'extracting') entry.extraction.controller.abort()
    }
    this.#entries.clear()
    await this.#extractor.close()
  }

  async #extract(feedItemId: number, link: string, extraction: Extraction): Promise<ReaderArticleOutcome> {
    // `reader.trace` carries the Reader's phases; the upstream phases are on
    // the `upstream.retrieval_*` record with the same `trace`.
    const trace = randomUUID()
    const signal = extraction.controller.signal
    const startedAt = performance.now()
    const finish = <Outcome extends ReaderArticleOutcome>(
      outcome: ReaderTraceOutcome,
      fields: LogFields,
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
      return finish('worker_failed', answered, { kind: 'unreadable' })
    }
    if (parsed.kind !== 'extracted') {
      return finish('unreadable', { ...answered, ...parsed.timings }, { kind: 'unreadable' })
    }

    const article: ReaderArticle = {
      feedItemId,
      markdown: parsed.article.markdown,
      readingTimeMinutes: parsed.article.readingTimeMinutes,
    }
    return finish('extracted', { ...answered, ...parsed.timings }, { kind: 'extracted', article })
  }

  async #waitForExtraction(
    feedItemId: number,
    extraction: Extraction,
    signal: AbortSignal | undefined,
  ): Promise<ReaderArticleOutcome> {
    extraction.waiters += 1
    const release = () => {
      extraction.waiters -= 1
      if (extraction.waiters > 0 || extraction.pastDeadline || !this.#isExtracting(feedItemId, extraction)) return
      this.#become(feedItemId, settled(extraction, undefined, this.#clock.now().getTime()))
      extraction.controller.abort()
    }

    if (signal?.aborted) {
      release()
      return ABANDONED_READER_OUTCOME
    }

    const answered = Promise.withResolvers<ReaderArticleOutcome>()
    const budget = setTimeout(() => {
      extraction.pastDeadline = true
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

  /** Forgets a stash past its minute and a failure episode past its cooldown. */
  #sweep(now: number): void {
    for (const [id, entry] of this.#entries) {
      const over =
        entry.kind === 'stashed'
          ? entry.expiresAt <= now
          : entry.kind === 'failing' && now - entry.lastAttemptAt >= RETRY_COOLDOWN_MS
      if (over) this.#entries.delete(id)
    }
  }

  #isExtracting(feedItemId: number, extraction: Extraction): boolean {
    const entry = this.#entries.get(feedItemId)
    return entry?.kind === 'extracting' && entry.extraction === extraction
  }

  #become(feedItemId: number, next: ReaderEntry | undefined): void {
    if (next) this.#entries.set(feedItemId, next)
    else this.#entries.delete(feedItemId)
  }
}

/**
 * What an extraction leaves for its Feed Item once it ends. An article that a
 * deadline already answered for is stashed for the refetch; a failure of the
 * publisher or the page extends the episode; anything else, including work
 * abandoned or thrown with no outcome, returns to the episode it began under.
 */
function settled(
  extraction: Extraction,
  outcome: ReaderArticleOutcome | undefined,
  now: number,
): ReaderEntry | undefined {
  if (outcome?.kind === 'extracted') {
    return extraction.pastDeadline
      ? { kind: 'stashed', article: outcome.article, expiresAt: now + STASH_TTL_MS }
      : undefined
  }
  const { episode } = extraction
  if (outcome && countsAsFailure(outcome)) {
    return { kind: 'failing', attempts: (episode?.attempts ?? 0) + 1, lastAttemptAt: now }
  }
  return episode ? { kind: 'failing', attempts: episode.attempts, lastAttemptAt: episode.lastAttemptAt } : undefined
}

/** A cancelled retrieval, or one this installation never sent, says nothing about the publisher or the page. */
function countsAsFailure(outcome: ReaderArticleOutcome): boolean {
  if (outcome.kind === 'unreadable') return true
  return outcome.kind === 'retrieval-failed' && outcome.failure.code !== 'cancelled' && outcome.failure.code !== 'busy'
}

function hostField(url: string): LogFields {
  try {
    return { host: new URL(url).host }
  } catch {
    return {}
  }
}
