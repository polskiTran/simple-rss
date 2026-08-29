import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import type { ReaderArticle, ReaderItem } from '../../shared/api.js'
import { elapsedMs, type Clock } from '../clock.js'
import { chronologyTime, dateKey, readerDate } from '../digest/chronology.js'
import type { DigestService } from '../digest/digest-service.js'
import type { LogField, LogFields, Logger } from '../logger.js'
import type { DrizzleDatabase } from '../persistence/database.js'
import type { InstallationSettingsStore } from '../persistence/installation-settings.js'
import { effectiveFeedTitle, feedItems, feeds, libraryItems, subscriptions } from '../persistence/schema.js'
import type { Retrieval, RetrievalFailure, RetrievalFailureCode, RetrievalTimings } from '../upstream/retrieval.js'
import type { ReaderExtractionTimings, ReaderExtractor } from './reader-extractor.js'

/** Every way one Reader operation can end, as named by its `reader.trace` record. */
type ReaderTraceOutcome = RetrievalFailureCode | 'extracted' | 'unreadable' | 'worker_failed' | 'deadline_exceeded'

/**
 * The total server share of the five-second Reader boundary: one budget from
 * before capacity queueing through retrieval, worker queueing, extraction, and
 * the Markdown policy, leaving ~500ms for the response and client rendering.
 */
export const READER_BUDGET_MS = 4_500

const RETRY_COOLDOWN_MS = 30_000

const ATTEMPTS_BEFORE_COOLDOWN = 5

/** Marks a budget abort so it is never mistaken for a browser leaving the Reader. */
class ReaderBudgetExceeded extends Error {
  constructor() {
    super('the Reader budget expired')
    this.name = 'ReaderBudgetExceeded'
  }
}

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
  | { readonly kind: 'deadline' }
  | { readonly kind: 'extracted'; readonly article: ReaderArticle }

interface InFlightExtraction {
  readonly controller: AbortController
  readonly work: Promise<ReaderArticleOutcome>
  waiters: number
}

const ABANDONED_READER_OUTCOME = {
  kind: 'retrieval-failed',
  failure: { ok: false, code: 'cancelled', reason: 'the browser left the Reader' },
} satisfies ReaderArticleOutcome

/** Not an unreadable document: the stored summary, open original, and retry all remain valid. */
const DEADLINE_READER_OUTCOME = { kind: 'deadline' } satisfies ReaderArticleOutcome

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

  constructor(options: {
    db: DrizzleDatabase
    clock: Clock
    settings: InstallationSettingsStore
    retrieval: Retrieval
    digest: DigestService
    extractor: ReaderExtractor
    logger: Logger
    /** Tests shorten the budget; production always runs `READER_BUDGET_MS`. */
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

    // The budget timer starts before the retrieval is even asked for, so
    // capacity queueing spends the same budget as every later phase.
    const controller = new AbortController()
    const budget = setTimeout(() => controller.abort(new ReaderBudgetExceeded()), this.#budgetMs)
    const work = this.#extract(feedItemId, link, controller.signal)
    const extraction: InFlightExtraction = { controller, work, waiters: 0 }
    this.#inFlight.set(feedItemId, extraction)
    const finish = () => {
      clearTimeout(budget)
      if (this.#inFlight.get(feedItemId) === extraction) this.#inFlight.delete(feedItemId)
    }
    void work.then(finish, finish)
    return this.#waitForExtraction(feedItemId, extraction, signal)
  }

  async close(): Promise<void> {
    for (const extraction of this.#inFlight.values()) extraction.controller.abort()
    this.#inFlight.clear()
    await this.#extractor.close()
  }

  async #extract(feedItemId: number, link: string, signal: AbortSignal): Promise<ReaderArticleOutcome> {
    const trace = randomUUID()
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

    // A budget abort surfaces as a cancellation from Retrieval and the worker;
    // the signal's reason tells the deadline apart from an abandoning browser.
    const budgetExpired = () => signal.reason instanceof ReaderBudgetExceeded

    const result = await this.#retrieval.retrieveBytes({ url: link, operation: 'reader', signal, trace })
    if (!result.ok) {
      const fields = {
        ...hostField(link),
        ...(result.status === undefined ? {} : { status: result.status }),
        ...definedFields(result.timings),
      }
      if (result.code === 'cancelled' && budgetExpired()) {
        return finish('deadline_exceeded', fields, DEADLINE_READER_OUTCOME)
      }
      if (result.code !== 'cancelled' && result.code !== 'busy') this.#recordFailure(feedItemId)
      return finish(result.code, fields, { kind: 'retrieval-failed', failure: result })
    }

    const answered = { ...hostField(result.url), ...definedFields(result.timings) }
    const bytes = ownedArrayBuffer(result.bytes)
    if (!bytes) {
      this.#recordFailure(feedItemId)
      return finish('unreadable', answered, { kind: 'unreadable' })
    }
    const extraction = await this.#extractor.extract({ bytes, charset: result.charset, url: result.url }, signal)
    if (extraction.kind === 'cancelled') {
      if (budgetExpired()) return finish('deadline_exceeded', answered, DEADLINE_READER_OUTCOME)
      return finish('cancelled', answered, ABANDONED_READER_OUTCOME)
    }
    if (extraction.kind === 'failed') {
      this.#recordFailure(feedItemId)
      return finish('worker_failed', answered, { kind: 'unreadable' })
    }
    if (extraction.kind !== 'extracted') {
      this.#recordFailure(feedItemId)
      return finish('unreadable', { ...answered, ...definedFields(extraction.timings) }, { kind: 'unreadable' })
    }
    const extracted = extraction.article

    this.#failures.delete(feedItemId)
    return finish(
      'extracted',
      { ...answered, ...definedFields(extraction.timings) },
      {
        kind: 'extracted',
        article: {
          feedItemId,
          markdown: extracted.markdown,
          readingTimeMinutes: extracted.readingTimeMinutes,
        },
      },
    )
  }

  async #waitForExtraction(
    feedItemId: number,
    extraction: InFlightExtraction,
    signal: AbortSignal | undefined,
  ): Promise<ReaderArticleOutcome> {
    extraction.waiters += 1
    const release = () => {
      extraction.waiters -= 1
      if (extraction.waiters === 0 && this.#inFlight.get(feedItemId) === extraction) {
        this.#inFlight.delete(feedItemId)
        extraction.controller.abort()
      }
    }

    if (signal?.aborted) {
      release()
      return ABANDONED_READER_OUTCOME
    }
    if (!signal) {
      try {
        return await extraction.work
      } finally {
        release()
      }
    }

    const abandoned = Promise.withResolvers<ReaderArticleOutcome>()
    const onAbort = () => abandoned.resolve(ABANDONED_READER_OUTCOME)
    signal.addEventListener('abort', onAbort, { once: true })
    try {
      return await Promise.race([extraction.work, abandoned.promise])
    } finally {
      signal.removeEventListener('abort', onAbort)
      release()
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

/**
 * `reader.trace` fields stay at the publisher-host level: never the URL path or
 * query, and never retrieved HTML, extracted Markdown, or Feed Item summaries.
 */
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

function ownedArrayBuffer(bytes: Uint8Array): ArrayBuffer | undefined {
  if (!(bytes.buffer instanceof ArrayBuffer)) return undefined
  if (bytes.byteOffset !== 0 || bytes.byteLength !== bytes.buffer.byteLength) return undefined
  return bytes.buffer
}
