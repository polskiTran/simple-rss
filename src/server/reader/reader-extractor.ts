import { Worker } from 'node:worker_threads'
import { z } from 'zod'
import type { Clock } from '../clock.js'
import { elapsedMs } from '../clock.js'
import { errorForLog, type Logger } from '../logger.js'
import type { ExtractedArticle, ExtractionTimings } from './extract-article.js'

export interface ReaderExtractionInput {
  readonly bytes: ArrayBuffer
  readonly charset?: string | undefined
  readonly url: string
}

export interface ReaderExtractionTimings extends ExtractionTimings {
  readonly workerQueueMs?: number | undefined
}

export type ReaderExtractionResult =
  | {
      readonly kind: 'extracted'
      readonly article: ExtractedArticle
      readonly timings: ReaderExtractionTimings
    }
  | { readonly kind: 'unreadable'; readonly timings: ReaderExtractionTimings }
  | { readonly kind: 'cancelled' }
  | { readonly kind: 'failed' }

export const readerWorkerRequestSchema = z.object({
  id: z.number().int().positive(),
  bytes: z.instanceof(ArrayBuffer),
  charset: z.string().optional(),
  url: z.string().url(),
  nowMilliseconds: z.number().finite(),
})

export type ReaderWorkerRequest = z.infer<typeof readerWorkerRequestSchema>

const extractedArticleSchema = z.object({
  markdown: z.string(),
  wordCount: z.number().int().nonnegative(),
  readingTimeMinutes: z.number().int().positive(),
})

const extractionTimingsSchema = z.object({
  domMs: z.number().nonnegative().optional(),
  defuddleMs: z.number().nonnegative().optional(),
  markdownPolicyMs: z.number().nonnegative().optional(),
})

export const readerWorkerReplySchema = z.discriminatedUnion('kind', [
  z.object({
    id: z.number().int().positive(),
    kind: z.literal('extracted'),
    article: extractedArticleSchema,
    timings: extractionTimingsSchema,
  }),
  z.object({ id: z.number().int().positive(), kind: z.literal('unreadable'), timings: extractionTimingsSchema }),
])

export type ReaderWorkerReply = z.infer<typeof readerWorkerReplySchema>

export const readerWorkerDataSchema = z.object({
  imageSigningKey: z.instanceof(Uint8Array).refine((key) => key.byteLength >= 32),
})

interface ExtractionTask {
  readonly id: number
  readonly input: ReaderExtractionInput
  readonly signal: AbortSignal
  readonly onAbort: () => void
  readonly resolve: (result: ReaderExtractionResult) => void
  readonly enqueuedAt: number
  workerQueueMs?: number
}

export class ReaderExtractor {
  readonly #clock: Clock
  readonly #imageSigningKey: Uint8Array
  readonly #logger: Logger
  readonly #workerUrl: URL
  readonly #queue: ExtractionTask[] = []
  #nextId = 1
  #worker: Worker | undefined
  #retirement: Promise<void> | undefined
  #active: ExtractionTask | undefined
  #closed = false

  constructor(options: {
    readonly clock: Clock
    readonly imageSigningKey: Uint8Array
    readonly logger: Logger
    readonly workerUrl?: URL | undefined
  }) {
    this.#clock = options.clock
    this.#imageSigningKey = options.imageSigningKey
    this.#logger = options.logger
    this.#workerUrl = options.workerUrl ?? readerWorkerUrl()
    this.#worker = this.#spawnWorker()
  }

  extract(input: ReaderExtractionInput, signal: AbortSignal): Promise<ReaderExtractionResult> {
    if (this.#closed || signal.aborted) return Promise.resolve({ kind: 'cancelled' })

    const id = this.#nextId
    this.#nextId += 1
    const { promise, resolve } = Promise.withResolvers<ReaderExtractionResult>()
    const task: ExtractionTask = {
      id,
      input,
      signal,
      onAbort: () => this.#cancel(id),
      resolve,
      enqueuedAt: performance.now(),
    }
    signal.addEventListener('abort', task.onAbort, { once: true })
    this.#queue.push(task)
    this.#logger.debug('reader.extraction_queued', { taskId: id })
    this.#pump()
    return promise
  }

  async close(): Promise<void> {
    if (this.#closed) return
    this.#closed = true

    const queued = this.#queue.splice(0, this.#queue.length)
    for (const task of queued) this.#settleCancelled(task)

    const active = this.#active
    this.#active = undefined
    if (active) this.#settleCancelled(active)

    const retirement = this.#retirement
    const worker = this.#worker
    this.#worker = undefined
    if (worker) {
      worker.removeAllListeners()
      await this.#terminateWorker(worker)
    }
    if (retirement) await retirement
  }

  #pump(): void {
    if (this.#closed || this.#retirement || this.#active || this.#queue.length === 0) return

    const worker = this.#worker ?? this.#spawnWorker()
    this.#worker = worker
    const task = this.#queue.shift()
    if (!task) return
    if (!worker) {
      this.#settle(task, { kind: 'failed' })
      this.#pump()
      return
    }

    this.#active = task
    task.workerQueueMs = elapsedMs(task.enqueuedAt)
    const request: ReaderWorkerRequest = {
      id: task.id,
      bytes: task.input.bytes,
      charset: task.input.charset,
      url: task.input.url,
      nowMilliseconds: this.#clock.now().getTime(),
    }
    try {
      worker.postMessage(request, [request.bytes])
    } catch (error) {
      this.#logger.error('reader.worker_post_failed', { error: errorForLog(error) })
      this.#replaceFailedWorker(worker)
    }
  }

  #cancel(id: number): void {
    const queuedIndex = this.#queue.findIndex((task) => task.id === id)
    if (queuedIndex >= 0) {
      const [task] = this.#queue.splice(queuedIndex, 1)
      if (task) this.#settleCancelled(task)
      return
    }

    const active = this.#active
    if (!active || active.id !== id) return
    this.#active = undefined
    this.#settleCancelled(active)

    const worker = this.#worker
    this.#worker = undefined
    if (worker) {
      this.#retireWorker(worker, true)
    } else {
      if (!this.#closed) this.#worker = this.#spawnWorker()
      this.#pump()
    }
  }

  #onMessage(worker: Worker, value: ReaderWorkerReply | undefined): void {
    if (worker !== this.#worker) return
    if (!value) {
      this.#logger.error('reader.worker_protocol_failed', {})
      this.#replaceFailedWorker(worker)
      return
    }

    const active = this.#active
    if (!active || value.id !== active.id) {
      this.#logger.error('reader.worker_protocol_failed', { taskId: value.id })
      this.#replaceFailedWorker(worker)
      return
    }

    this.#active = undefined
    const timings: ReaderExtractionTimings =
      active.workerQueueMs === undefined ? value.timings : { ...value.timings, workerQueueMs: active.workerQueueMs }
    this.#settle(
      active,
      value.kind === 'extracted'
        ? { kind: 'extracted', article: value.article, timings }
        : { kind: 'unreadable', timings },
    )
    this.#pump()
  }

  #replaceFailedWorker(worker: Worker, error?: Error): void {
    if (worker !== this.#worker) return
    this.#worker = undefined
    const replace = this.#active !== undefined || this.#queue.length > 0

    if (error !== undefined) {
      this.#logger.error('reader.worker_failed', { error: errorForLog(error) })
    }
    const active = this.#active
    this.#active = undefined
    if (active) this.#settle(active, { kind: 'failed' })

    this.#retireWorker(worker, replace)
  }

  #spawnWorker(): Worker | undefined {
    if (this.#closed) return undefined
    try {
      const worker = createReaderWorker(this.#workerUrl, this.#imageSigningKey)
      worker.on('message', (value) => {
        const reply = readerWorkerReplySchema.safeParse(value)
        this.#onMessage(worker, reply.success ? reply.data : undefined)
      })
      worker.on('error', (error) => this.#replaceFailedWorker(worker, error))
      worker.on('exit', (code) => {
        if (worker === this.#worker) {
          this.#replaceFailedWorker(worker, new Error(`Reader worker exited with code ${code}`))
        }
      })
      return worker
    } catch (error) {
      this.#logger.error('reader.worker_start_failed', { error: errorForLog(error) })
      return undefined
    }
  }

  #retireWorker(worker: Worker, replace: boolean): void {
    worker.removeAllListeners()
    const retirement = this.#terminateWorker(worker)
    this.#retirement = retirement
    void retirement.then(() => {
      if (this.#retirement !== retirement) return
      this.#retirement = undefined
      if (!this.#closed && replace) this.#worker = this.#spawnWorker()
      this.#pump()
    })
  }

  async #terminateWorker(worker: Worker): Promise<void> {
    try {
      await worker.terminate()
    } catch (error) {
      this.#logger.error('reader.worker_termination_failed', { error: errorForLog(error) })
    }
  }

  #settle(task: ExtractionTask, result: ReaderExtractionResult): void {
    task.signal.removeEventListener('abort', task.onAbort)
    task.resolve(result)
  }

  #settleCancelled(task: ExtractionTask): void {
    this.#settle(task, { kind: 'cancelled' })
    this.#logger.debug('reader.extraction_cancelled', { taskId: task.id })
  }
}

function readerWorkerUrl(): URL {
  const extension = import.meta.url.endsWith('.ts') ? 'ts' : 'js'
  return new URL(`./extract-article-worker.${extension}`, import.meta.url)
}

function createReaderWorker(url: URL, imageSigningKey: Uint8Array): Worker {
  const workerData = { imageSigningKey }
  if (!url.pathname.endsWith('.ts')) return new Worker(url, { workerData })

  return new Worker(
    `const { workerData } = require('node:worker_threads');
const { tsImport } = require('tsx/esm/api');
void tsImport(workerData.moduleUrl, workerData.moduleUrl);`,
    {
      eval: true,
      workerData: { ...workerData, moduleUrl: url.href },
    },
  )
}
