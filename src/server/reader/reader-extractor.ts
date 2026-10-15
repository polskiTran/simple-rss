import { Worker } from 'node:worker_threads'
import { z } from 'zod'
import type { Clock } from '../clock.js'
import { elapsedMs } from '../monotonic.js'
import type { Logger } from '../logger.js'
import { IMAGE_URL_KEY_BYTES } from '../images/image-url-signature.js'
import type { ExtractedArticle, ExtractionTimings } from './extract-article.js'

export interface ReaderExtractionInput {
  /** Transferred to the worker, which detaches it from the caller. */
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
  imageSigningKey: z.instanceof(Uint8Array).refine((key) => key.byteLength >= IMAGE_URL_KEY_BYTES),
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

type ReaderWorkerSlot =
  | { readonly kind: 'absent' }
  | { readonly kind: 'idle'; readonly worker: Worker }
  | { readonly kind: 'running'; readonly worker: Worker; readonly task: ExtractionTask }

export class ReaderExtractor {
  readonly #clock: Clock
  readonly #imageSigningKey: Uint8Array
  readonly #logger: Logger
  readonly #workerUrl: URL
  readonly #queue: ExtractionTask[] = []
  #nextId = 1
  #retirement: Promise<void> | undefined
  #slot: ReaderWorkerSlot = { kind: 'absent' }
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
    const worker = this.#spawnWorker()
    this.#slot = worker ? { kind: 'idle', worker } : { kind: 'absent' }
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

    const slot = this.#slot
    this.#slot = { kind: 'absent' }
    if (slot.kind === 'running') this.#settleCancelled(slot.task)

    const retirement = this.#retirement
    if (slot.kind !== 'absent') {
      slot.worker.removeAllListeners()
      await this.#terminateWorker(slot.worker)
    }
    if (retirement) await retirement
  }

  #pump(): void {
    if (this.#closed || this.#retirement || this.#slot.kind === 'running' || this.#queue.length === 0) return

    let worker = this.#slot.kind === 'idle' ? this.#slot.worker : undefined
    if (!worker) {
      worker = this.#spawnWorker()
      if (!worker) {
        const failed = this.#queue.shift()
        if (!failed) return
        this.#settle(failed, { kind: 'failed' })
        this.#pump()
        return
      }
    }

    const task = this.#queue.shift()
    if (!task) {
      this.#slot = { kind: 'idle', worker }
      return
    }

    this.#slot = { kind: 'running', worker, task }
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
      this.#logger.error('reader.worker_post_failed', { error })
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

    if (this.#slot.kind !== 'running' || this.#slot.task.id !== id) return
    const { worker, task } = this.#slot
    this.#slot = { kind: 'absent' }
    this.#settleCancelled(task)
    this.#retireWorker(worker, true)
  }

  #onMessage(worker: Worker, value: ReaderWorkerReply | undefined): void {
    const slot = this.#slot
    if (slot.kind === 'absent' || slot.worker !== worker) return
    if (!value) {
      this.#logger.error('reader.worker_protocol_failed', {})
      this.#replaceFailedWorker(worker)
      return
    }

    if (slot.kind !== 'running' || value.id !== slot.task.id) {
      this.#logger.error('reader.worker_protocol_failed', { taskId: value.id })
      this.#replaceFailedWorker(worker)
      return
    }

    this.#slot = { kind: 'idle', worker }
    const timings: ReaderExtractionTimings =
      slot.task.workerQueueMs === undefined
        ? value.timings
        : { ...value.timings, workerQueueMs: slot.task.workerQueueMs }
    this.#settle(
      slot.task,
      value.kind === 'extracted'
        ? { kind: 'extracted', article: value.article, timings }
        : { kind: 'unreadable', timings },
    )
    this.#pump()
  }

  #replaceFailedWorker(worker: Worker, error?: Error): void {
    const slot = this.#slot
    if (slot.kind === 'absent' || slot.worker !== worker) return
    const task = slot.kind === 'running' ? slot.task : undefined
    const replace = task !== undefined || this.#queue.length > 0
    this.#slot = { kind: 'absent' }

    if (error !== undefined) {
      this.#logger.error('reader.worker_failed', { error })
    }
    if (task) this.#settle(task, { kind: 'failed' })

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
        const slot = this.#slot
        if (slot.kind !== 'absent' && slot.worker === worker) {
          this.#replaceFailedWorker(worker, new Error(`Reader worker exited with code ${code}`))
        }
      })
      return worker
    } catch (error) {
      this.#logger.error('reader.worker_start_failed', { error })
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
      if (!this.#closed && replace) {
        const spawned = this.#spawnWorker()
        this.#slot = spawned ? { kind: 'idle', worker: spawned } : { kind: 'absent' }
      }
      this.#pump()
    })
  }

  async #terminateWorker(worker: Worker): Promise<void> {
    try {
      await worker.terminate()
    } catch (error) {
      this.#logger.error('reader.worker_termination_failed', { error })
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
