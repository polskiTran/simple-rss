import { MAX_FEED_SIZE_MIB } from '../../shared/api.js'
import { VERSION } from '../version.js'
import type { LogFields, Logger } from '../logger.js'
import {
  ResolutionCapacityError,
  systemResolver,
  validateDestination,
  type DestinationPolicy,
  type ResolveAddresses,
} from './destination.js'
import { elapsedMs } from '../monotonic.js'
import { HttpClientError, type HttpClient, type HttpTimings } from './http-client.js'
import { createNetworkHttpClient } from './network-client.js'

/** Every operation follows at most this many redirects. */
const MAX_REDIRECTS = 5

const DEFAULT_CAPACITY: RetrievalCapacity = { maxConcurrent: 6, maxQueued: 32 }

export type RetrievalOperation = 'feed' | 'reader' | 'image'

export interface RetrievalCapacity {
  readonly maxConcurrent: number
  readonly maxQueued: number
}

export interface RetrievalProfile {
  readonly accept: readonly string[]
  readonly maxBytes: number
  /** Covers resolution, connection, every redirect hop, and the final response headers. */
  readonly timeoutMs: number
  /** Separate from timeoutMs: a slow large body is not an unreachable host. */
  readonly bodyTimeoutMs: number
  readonly capacity: RetrievalCapacity
}

export const RETRIEVAL_PROFILES = {
  feed: {
    accept: ['application/rss+xml', 'application/atom+xml', 'application/xml', 'text/xml'],
    maxBytes: MAX_FEED_SIZE_MIB * 1024 * 1024,
    timeoutMs: 10_000,
    bodyTimeoutMs: 60_000,
    capacity: { maxConcurrent: 4, maxQueued: 24 },
  },
  reader: {
    accept: ['text/html', 'application/xhtml+xml'],
    maxBytes: 5 * 1024 * 1024,
    timeoutMs: 10_000,
    bodyTimeoutMs: 30_000,
    capacity: { maxConcurrent: 4, maxQueued: 16 },
  },
  image: {
    accept: ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif'],
    maxBytes: 5 * 1024 * 1024,
    timeoutMs: 10_000,
    bodyTimeoutMs: 30_000,
    capacity: { maxConcurrent: 4, maxQueued: 16 },
  },
} satisfies Readonly<Record<RetrievalOperation, RetrievalProfile>>

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308])

const USER_AGENT = `simple-rss/${VERSION}`

export type RetrievalFailureCode =
  | 'invalid_url'
  | 'blocked_destination'
  | 'unresolvable_host'
  | 'invalid_redirect'
  | 'too_many_redirects'
  | 'redirect_loop'
  | 'unsupported_content_type'
  | 'unsupported_content_encoding'
  | 'too_large'
  | 'http_error'
  /** The publisher never answered. */
  | 'timeout'
  /** Answered, but the body did not finish arriving. */
  | 'body_timeout'
  | 'cancelled'
  | 'busy'
  | 'unavailable'

export interface RetrievalRequest {
  readonly url: string | URL
  readonly operation: RetrievalOperation
  /** Validators kept from an earlier answer, null when it sent none; a match is answered `notModified`. */
  readonly conditional?: { readonly etag: string | null; readonly lastModified: string | null }
  readonly signal?: AbortSignal
  /** Joins this retrieval's `upstream.retrieval_*` log to the caller's own. */
  readonly trace?: string
}

export interface RetrievalSuccess {
  readonly ok: true
  readonly status: number
  /** The final redirect hop, not the URL that was asked for. */
  readonly url: string
  readonly contentType: string
  readonly charset: string | undefined
  readonly etag: string | undefined
  readonly lastModified: string | undefined
  /** True when a conditional request was answered `304` and there is no body. */
  readonly notModified: boolean
  /** Reading past the profile's byte ceiling errors the stream with a `RetrievalError`. */
  readonly body: ReadableStream<Uint8Array>
}

export interface RetrievalFailure {
  readonly ok: false
  readonly code: RetrievalFailureCode
  /** Safe for logs and never shown raw to the User. */
  readonly reason: string
  /** Present for `http_error`, so a caller can tell 404 from 503. */
  readonly status?: number
}

export type RetrievalResult = RetrievalSuccess | RetrievalFailure

export interface RetrievalBytes extends Omit<RetrievalSuccess, 'body'> {
  readonly bytes: Uint8Array
}

export type RetrievalBytesResult = RetrievalBytes | RetrievalFailure

export interface Retrieval {
  /** The caller must consume or cancel the body; that frees the capacity slot. */
  retrieve(request: RetrievalRequest): Promise<RetrievalResult>
  retrieveBytes(request: RetrievalRequest): Promise<RetrievalBytesResult>
}

interface RetrievalOptions {
  readonly httpClient: HttpClient
  readonly logger: Logger
  readonly resolve?: ResolveAddresses
  /** The installation's canonical public origin. */
  readonly self: URL
  readonly capacity?: RetrievalCapacity
  readonly operationCapacity?: Partial<Record<RetrievalOperation, RetrievalCapacity>>
}

/** Thrown into a body stream when it cannot be finished. Carries the same categories. */
export class RetrievalError extends Error {
  readonly code: RetrievalFailureCode

  constructor(code: RetrievalFailureCode, message: string) {
    super(message)
    this.name = 'RetrievalError'
    this.code = code
  }
}

/**
 * The single outbound HTTP boundary (ADR 0005). Callers name an operation;
 * the module owns its content, size, redirect, and capacity policy.
 */
export function createRetrieval(options: RetrievalOptions): Retrieval {
  const logger = options.logger.child({ component: 'upstream' })
  const sharedCapacity = options.capacity ?? DEFAULT_CAPACITY
  const resolver = new BoundedResolver(options.resolve ?? systemResolver, sharedCapacity)
  const policy: DestinationPolicy = { resolve: resolver.resolve, self: options.self }
  const shared = new ConcurrencyGate(sharedCapacity)
  const operationGates = {
    feed: new ConcurrencyGate(options.operationCapacity?.feed ?? RETRIEVAL_PROFILES.feed.capacity),
    reader: new ConcurrencyGate(options.operationCapacity?.reader ?? RETRIEVAL_PROFILES.reader.capacity),
    image: new ConcurrencyGate(options.operationCapacity?.image ?? RETRIEVAL_PROFILES.image.capacity),
  } satisfies Record<RetrievalOperation, ConcurrencyGate>

  const retrieve = (request: RetrievalRequest): Promise<RetrievalResult> =>
    run(request, {
      httpClient: options.httpClient,
      logger,
      policy,
      gates: [operationGates[request.operation], shared],
    })

  return {
    retrieve,
    retrieveBytes: async (request) => collect(await retrieve(request)),
  }
}

export function createNetworkRetrieval(options: { readonly logger: Logger; readonly self: URL }): Retrieval {
  return createRetrieval({
    httpClient: createNetworkHttpClient(),
    logger: options.logger,
    self: options.self,
  })
}

type Abandonment = 'timeout' | 'body_timeout' | 'cancelled'

function abandonmentReason(kind: Abandonment): string {
  if (kind === 'timeout') return 'no answer in time'
  if (kind === 'body_timeout') return 'the answer did not finish arriving in time'
  return 'caller abandoned the retrieval'
}

interface RunContext {
  readonly httpClient: HttpClient
  readonly logger: Logger
  readonly policy: DestinationPolicy
  readonly gates: readonly ConcurrencyGate[]
}

/** Where the time went, for the `upstream.retrieval_*` log only. */
interface Phases {
  queueMs?: number
  dnsMs?: number
  connectionReused?: boolean
  connectMs?: number
  tlsMs?: number
  ttfbMs?: number
  bodyMs?: number
  bytes?: number
}

async function run(request: RetrievalRequest, context: RunContext): Promise<RetrievalResult> {
  const startedAt = performance.now()
  const phases: Phases = {}
  let redirects = 0
  const { maxBytes, timeoutMs, bodyTimeoutMs, accept } = RETRIEVAL_PROFILES[request.operation]
  const headers = requestHeaders(accept, request.conditional)

  const controller = new AbortController()
  let abandoned: Abandonment | undefined
  const abort = (kind: Abandonment, message: string) => {
    abandoned ??= kind
    controller.abort(new RetrievalError(kind, message))
  }

  let timer = setTimeout(() => abort('timeout', `no answer within ${timeoutMs}ms`), timeoutMs)

  const startBodyDeadline = (): void => {
    clearTimeout(timer)
    timer = setTimeout(() => abort('body_timeout', `body unfinished after ${bodyTimeoutMs}ms`), bodyTimeoutMs)
  }

  const onCancel = () => abort('cancelled', 'caller abandoned the retrieval')
  request.signal?.addEventListener('abort', onCancel, { once: true })

  let entered = 0
  let settled = false

  const settle = (): void => {
    if (settled) return
    settled = true
    clearTimeout(timer)
    request.signal?.removeEventListener('abort', onCancel)
    for (let index = entered - 1; index >= 0; index -= 1) context.gates[index]?.leave()
  }

  const log = (event: string, fields: LogFields): void => {
    const level = event === 'upstream.retrieval_completed' ? 'debug' : 'warn'
    context.logger[level](event, {
      operation: request.operation,
      ...(request.trace === undefined ? {} : { trace: request.trace }),
      ...phases,
      redirects,
      ...fields,
      durationMs: elapsedMs(startedAt),
    })
  }

  const fail = (
    code: RetrievalFailureCode,
    reason: string,
    fields: LogFields = {},
    status?: number,
  ): RetrievalFailure => {
    settle()
    log('upstream.retrieval_failed', { code, reason, ...fields })
    return { ok: false, code, reason, ...(status === undefined ? {} : { status }) }
  }

  if (request.signal?.aborted) return fail('cancelled', 'caller abandoned the retrieval')

  const queueStartedAt = performance.now()
  for (const gate of context.gates) {
    if (!(await gate.enter(controller.signal))) {
      phases.queueMs = elapsedMs(queueStartedAt)
      return abandoned
        ? fail(abandoned, `gave up waiting for a retrieval slot`)
        : fail('busy', 'no retrieval slot available')
    }
    entered += 1
  }
  phases.queueMs = elapsedMs(queueStartedAt)

  let target: string | URL = request.url
  const visited = new Set<string>()

  const recordConnection = (connection: HttpTimings): void => {
    delete phases.connectMs
    delete phases.tlsMs
    delete phases.ttfbMs
    phases.connectionReused = connection.connectionReused
    if (connection.connectMs !== undefined) phases.connectMs = connection.connectMs
    if (connection.tlsMs !== undefined) phases.tlsMs = connection.tlsMs
    if (connection.ttfbMs !== undefined) phases.ttfbMs = connection.ttfbMs
  }

  for (; ; redirects += 1) {
    const dnsStartedAt = performance.now()
    const destination = await validateDestination(target, context.policy, controller.signal)
    phases.dnsMs = (phases.dnsMs ?? 0) + elapsedMs(dnsStartedAt)
    if (abandoned) return fail(abandoned, abandonmentReason(abandoned))
    if (!destination.ok) return fail(destination.code, destination.reason)

    const { url, addresses } = destination
    if (visited.has(url.href)) {
      return fail('redirect_loop', 'redirect returned to a URL already visited', { host: url.host })
    }
    visited.add(url.href)

    let response: Response
    try {
      response = await context.httpClient(
        new Request(url, { method: 'GET', headers, redirect: 'manual', signal: controller.signal }),
        { addresses, onTimings: recordConnection },
      )
    } catch (error) {
      if (abandoned) return fail(abandoned, abandonmentReason(abandoned), { host: url.host })
      if (error instanceof HttpClientError) return fail(error.code, error.message, { host: url.host })
      return fail('unavailable', describe(error), { host: url.host })
    }

    if (REDIRECT_STATUSES.has(response.status)) {
      await discard(response)
      const location = response.headers.get('location')
      if (!location) {
        return fail('invalid_redirect', `${response.status} without a location`, { host: url.host })
      }
      if (redirects >= MAX_REDIRECTS) {
        controller.abort(new RetrievalError('too_many_redirects', 'redirect limit reached'))
        return fail('too_many_redirects', `more than ${MAX_REDIRECTS} redirects`, { host: url.host })
      }

      try {
        target = new URL(location, url)
      } catch {
        return fail('invalid_redirect', 'unparseable redirect location', { host: url.host })
      }
      continue
    }

    const answered = { host: url.host, path: url.pathname, status: response.status }

    if (response.status === 304) {
      await discard(response)
      settle()
      log('upstream.retrieval_completed', { ...answered, bytes: 0, notModified: true })
      return {
        ok: true,
        status: 304,
        url: url.href,
        contentType: '',
        charset: undefined,
        etag: response.headers.get('etag') ?? undefined,
        lastModified: response.headers.get('last-modified') ?? undefined,
        notModified: true,
        body: emptyStream(),
      }
    }

    if (!response.ok) {
      await discard(response)
      controller.abort(new RetrievalError('http_error', `upstream answered ${response.status}`))
      return fail('http_error', `upstream answered ${response.status}`, answered, response.status)
    }

    const contentType = mediaType(response.headers.get('content-type'))
    if (!accepted(contentType, accept)) {
      await discard(response)
      controller.abort(new RetrievalError('unsupported_content_type', 'unusable content type'))
      return fail('unsupported_content_type', contentType ? `content type ${contentType}` : 'no content type', answered)
    }

    const declared = Number(response.headers.get('content-length'))
    if (Number.isFinite(declared) && declared > maxBytes) {
      await discard(response)
      controller.abort(new RetrievalError('too_large', 'declared length above the ceiling'))
      return fail('too_large', `declared ${declared} bytes above the ${maxBytes} ceiling`, answered)
    }

    startBodyDeadline()
    const bodyStartedAt = performance.now()
    return {
      ok: true,
      status: response.status,
      url: url.href,
      contentType,
      charset: charsetOf(response.headers.get('content-type')),
      etag: response.headers.get('etag') ?? undefined,
      lastModified: response.headers.get('last-modified') ?? undefined,
      notModified: false,
      body: boundedBody(response, {
        maxBytes,
        signal: controller.signal,
        abandonedKind: () => abandoned,
        abort: (error) => controller.abort(error),
        finish: (bytes, error) => {
          phases.bodyMs = elapsedMs(bodyStartedAt)
          phases.bytes = bytes
          settle()
          if (error) log('upstream.retrieval_failed', { ...answered, code: error.code, reason: error.message, bytes })
          else log('upstream.retrieval_completed', { ...answered, bytes, notModified: false })
        },
      }),
    }
  }
}

interface BoundedBodyOptions {
  readonly maxBytes: number
  readonly signal: AbortSignal
  readonly abandonedKind: () => Abandonment | undefined
  readonly abort: (error: RetrievalError) => void
  readonly finish: (bytes: number, error: RetrievalError | undefined) => void
}

/**
 * Counts decoded bytes and tears the connection down past the ceiling.
 * `Content-Length` is only a hint: compressed bodies expand and hostile ones lie.
 */
function boundedBody(response: Response, options: BoundedBodyOptions): ReadableStream<Uint8Array> {
  const source = response.body
  if (!source) {
    options.finish(0, undefined)
    return emptyStream()
  }

  const reader = source.getReader()
  let seen = 0
  let done = false
  let sink: ReadableStreamDefaultController<Uint8Array> | undefined

  const stop = (error: RetrievalError | undefined): void => {
    if (done) return
    done = true
    if (error) options.abort(error)
    void reader.cancel(error).catch(() => {})
    if (error) sink?.error(error)
    options.finish(seen, error)
  }

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      sink = controller
    },
    async pull(controller) {
      try {
        const chunk = await reader.read()
        if (chunk.done) {
          if (!done) {
            done = true
            options.finish(seen, undefined)
          }
          controller.close()
          return
        }

        seen += chunk.value.byteLength
        if (seen > options.maxBytes) {
          stop(new RetrievalError('too_large', `body passed the ${options.maxBytes} byte ceiling`))
          return
        }

        controller.enqueue(chunk.value)
      } catch (cause) {
        const abandoned = options.abandonedKind()
        stop(cause instanceof RetrievalError ? cause : new RetrievalError(abandoned ?? 'unavailable', describe(cause)))
      }
    },
    cancel(reason) {
      stop(reason instanceof RetrievalError ? reason : new RetrievalError('cancelled', 'body was cancelled'))
    },
  })

  // The body deadline can fire while nobody is pulling; without this a stream
  // that is never read would hold its slot forever.
  const abandon = (): void => {
    const reason = options.signal.reason
    stop(
      reason instanceof RetrievalError
        ? reason
        : new RetrievalError(options.abandonedKind() ?? 'cancelled', 'the retrieval was abandoned'),
    )
  }
  if (options.signal.aborted) abandon()
  else options.signal.addEventListener('abort', abandon, { once: true })

  return stream
}

async function collect(result: RetrievalResult): Promise<RetrievalBytesResult> {
  if (!result.ok) return result

  const chunks: Uint8Array[] = []
  let total = 0

  try {
    const reader = result.body.getReader()
    for (;;) {
      const chunk = await reader.read()
      if (chunk.done) break
      chunks.push(chunk.value)
      total += chunk.value.byteLength
    }
  } catch (error) {
    const code = error instanceof RetrievalError ? error.code : 'unavailable'
    return { ok: false, code, reason: describe(error) }
  }

  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }

  const { body: _body, ...rest } = result
  return { ...rest, bytes }
}

function requestHeaders(accept: readonly string[], conditional: RetrievalRequest['conditional']): Headers {
  const headers = new Headers({ accept: accept.join(', '), 'user-agent': USER_AGENT })
  if (conditional?.etag) headers.set('if-none-match', conditional.etag)
  if (conditional?.lastModified) headers.set('if-modified-since', conditional.lastModified)
  return headers
}

function mediaType(contentType: string | null): string {
  return (contentType ?? '').split(';')[0]?.trim().toLowerCase() ?? ''
}

function charsetOf(contentType: string | null): string | undefined {
  const charset = /;\s*charset\s*=\s*"?([\w-]+)"?/i.exec(contentType ?? '')?.[1]
  return charset?.toLowerCase()
}

function accepted(contentType: string, accept: readonly string[]): boolean {
  if (contentType === '') return false
  return accept.some((allowed) => allowed.trim().toLowerCase() === contentType)
}

async function discard(response: Response): Promise<void> {
  try {
    await response.body?.cancel()
  } catch {}
}

function emptyStream(): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.close()
    },
  })
}

function describe(cause: unknown): string {
  if (cause instanceof Error) return cause.message
  return 'upstream request failed'
}

class ConcurrencyGate {
  readonly #limit: number
  readonly #queueLimit: number
  readonly #waiting: Array<(granted: boolean) => void> = []
  #active = 0

  constructor({ maxConcurrent, maxQueued }: RetrievalCapacity) {
    if (
      !Number.isSafeInteger(maxConcurrent) ||
      maxConcurrent < 1 ||
      !Number.isSafeInteger(maxQueued) ||
      maxQueued < 0
    ) {
      throw new Error('retrieval capacity must use finite non-negative integers')
    }
    this.#limit = maxConcurrent
    this.#queueLimit = maxQueued
  }

  /** Resolves true holding a slot; false when full or the caller aborted. */
  async enter(signal: AbortSignal): Promise<boolean> {
    if (this.#active < this.#limit) {
      this.#active += 1
      return true
    }
    if (this.#waiting.length >= this.#queueLimit || signal.aborted) return false

    return new Promise<boolean>((resolve) => {
      const settle = (granted: boolean): void => {
        signal.removeEventListener('abort', onAbort)
        const index = this.#waiting.indexOf(settle)
        if (index !== -1) this.#waiting.splice(index, 1)
        resolve(granted)
      }
      const onAbort = (): void => settle(false)

      signal.addEventListener('abort', onAbort, { once: true })
      this.#waiting.push(settle)
    })
  }

  leave(): void {
    const next = this.#waiting.shift()
    if (next) next(true)
    else this.#active = Math.max(0, this.#active - 1)
  }
}

/**
 * The DNS gate stays occupied until the OS lookup settles, even after the
 * caller's deadline: a broken resolver cannot pile up unbounded lookups.
 */
class BoundedResolver {
  readonly #resolve: ResolveAddresses
  readonly #gate: ConcurrencyGate

  constructor(resolve: ResolveAddresses, capacity: RetrievalCapacity) {
    this.#resolve = resolve
    this.#gate = new ConcurrencyGate(capacity)
  }

  readonly resolve: ResolveAddresses = async (hostname, signal) => {
    if (!(await this.#gate.enter(signal))) {
      if (signal.aborted) throw signal.reason
      throw new ResolutionCapacityError()
    }

    const resolution = Promise.resolve().then(() => this.#resolve(hostname, signal))
    void resolution.finally(() => this.#gate.leave()).catch(() => {})

    if (signal.aborted) throw signal.reason
    return new Promise<readonly string[]>((resolve, reject) => {
      const onAbort = (): void => reject(signal.reason)
      signal.addEventListener('abort', onAbort, { once: true })
      resolution.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort))
    })
  }
}
