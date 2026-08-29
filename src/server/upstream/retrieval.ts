import { MAX_FEED_SIZE_MIB } from '../../shared/api.js'
import { VERSION } from '../../shared/version.js'
import { hasOwn } from '../../shared/record.js'
import type { LogFields, Logger } from '../logger.js'
import {
  ResolutionCapacityError,
  systemResolver,
  validateDestination,
  type DestinationPolicy,
  type ResolveAddresses,
} from './destination.js'
import { elapsedMs } from '../clock.js'
import { HttpClientError, type HttpClient, type HttpTimings } from './http-client.js'
import { createNetworkHttpClient } from './network-client.js'

export const MAX_REDIRECTS = 5

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
  readonly maxRedirects: number
  readonly capacity: RetrievalCapacity
}

export const RETRIEVAL_PROFILES = {
  feed: {
    accept: ['application/rss+xml', 'application/atom+xml', 'application/xml', 'text/xml'],
    maxBytes: MAX_FEED_SIZE_MIB * 1024 * 1024,
    timeoutMs: 10_000,
    bodyTimeoutMs: 60_000,
    maxRedirects: MAX_REDIRECTS,
    capacity: { maxConcurrent: 4, maxQueued: 24 },
  },
  reader: {
    accept: ['text/html', 'application/xhtml+xml'],
    maxBytes: 5 * 1024 * 1024,
    timeoutMs: 10_000,
    bodyTimeoutMs: 30_000,
    maxRedirects: MAX_REDIRECTS,
    capacity: { maxConcurrent: 4, maxQueued: 16 },
  },
  image: {
    accept: ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif'],
    maxBytes: 5 * 1024 * 1024,
    timeoutMs: 10_000,
    bodyTimeoutMs: 30_000,
    maxRedirects: MAX_REDIRECTS,
    capacity: { maxConcurrent: 4, maxQueued: 16 },
  },
} satisfies Readonly<Record<RetrievalOperation, RetrievalProfile>>

/** Can only tighten the operation profile; non-finite values are rejected. */
export interface RetrievalLimits {
  readonly maxBytes?: number
  readonly timeoutMs?: number
  readonly bodyTimeoutMs?: number
  readonly maxRedirects?: number
}

const FORWARDABLE_HEADERS = {
  'accept-language': true,
  'if-modified-since': true,
  'if-none-match': true,
} as const satisfies Readonly<Record<string, true>>

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308])

const USER_AGENT = `simple-rss/${VERSION}`

export type RetrievalFailureCode =
  | 'invalid_request'
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
  /** Filtered to `FORWARDABLE_HEADERS`; anything else is dropped. */
  readonly headers?: Readonly<Record<string, string>>
  readonly signal?: AbortSignal
  /** Optional stricter limits; values above the profile are clamped. */
  readonly limits?: RetrievalLimits
  /** Opaque correlation id stamped on this retrieval's log records. */
  readonly trace?: string
}

/**
 * Millisecond phase durations for one retrieval. A phase that never ran — a
 * reused connection's DNS, connect, and TLS; a body that never started — is
 * absent rather than reported as zero elapsed time. Connection phases describe
 * the final redirect hop; `dnsMs` sums destination validation across hops.
 */
export interface RetrievalTimings {
  readonly queueMs?: number
  readonly dnsMs?: number
  readonly connectionReused?: boolean
  readonly socketDnsMs?: number
  readonly connectMs?: number
  readonly tlsMs?: number
  readonly ttfbMs?: number
  readonly bodyMs?: number
  /** Decoded bytes received, counted by the body ceiling. */
  readonly bytes?: number
  readonly redirects: number
  readonly totalMs?: number
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
  /** Phases so far; body and total settle once `body` has been fully consumed or cancelled. */
  readonly timings: RetrievalTimings
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
  /** Present when the boundary itself produced the failure. */
  readonly timings?: RetrievalTimings
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
  const sharedCapacity = validCapacity(options.capacity ?? DEFAULT_CAPACITY)
  const resolver = new BoundedResolver(options.resolve ?? systemResolver, sharedCapacity)
  const policy: DestinationPolicy = { resolve: resolver.resolve, self: options.self }
  const shared = new ConcurrencyGate(sharedCapacity.maxConcurrent, sharedCapacity.maxQueued)
  const operationGates = {
    feed: gateFor(options.operationCapacity?.feed ?? RETRIEVAL_PROFILES.feed.capacity),
    reader: gateFor(options.operationCapacity?.reader ?? RETRIEVAL_PROFILES.reader.capacity),
    image: gateFor(options.operationCapacity?.image ?? RETRIEVAL_PROFILES.image.capacity),
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

type MutableTimings = { -readonly [Phase in keyof RetrievalTimings]: RetrievalTimings[Phase] }

async function run(request: RetrievalRequest, context: RunContext): Promise<RetrievalResult> {
  const startedAt = performance.now()
  const timings: MutableTimings = { redirects: 0 }
  const profile = RETRIEVAL_PROFILES[request.operation]
  const limits = stricterLimits(profile, request.limits)
  const maxRedirects = limits?.maxRedirects ?? profile.maxRedirects
  const maxBytes = limits?.maxBytes ?? profile.maxBytes
  const timeoutMs = limits?.timeoutMs ?? profile.timeoutMs
  const bodyTimeoutMs = limits?.bodyTimeoutMs ?? profile.bodyTimeoutMs
  const headers = forwardableHeaders(request.headers, profile.accept)

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
    timings.totalMs = elapsedMs(startedAt)
    clearTimeout(timer)
    request.signal?.removeEventListener('abort', onCancel)
    for (let index = entered - 1; index >= 0; index -= 1) context.gates[index]?.leave()
  }

  const log = (event: string, fields: LogFields): void => {
    const level = event === 'upstream.retrieval_completed' ? 'debug' : 'warn'
    const { totalMs: _totalMs, ...phases } = timings
    context.logger[level](event, {
      operation: request.operation,
      ...(request.trace === undefined ? {} : { trace: request.trace }),
      ...phases,
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
    return { ok: false, code, reason, timings, ...(status === undefined ? {} : { status }) }
  }

  if (!limits) return fail('invalid_request', 'retrieval limits must be finite numbers')

  if (request.signal?.aborted) return fail('cancelled', 'caller abandoned the retrieval')

  const queueStartedAt = performance.now()
  for (const gate of context.gates) {
    if (!(await gate.enter(controller.signal))) {
      timings.queueMs = elapsedMs(queueStartedAt)
      return abandoned
        ? fail(abandoned, `gave up waiting for a retrieval slot`)
        : fail('busy', 'no retrieval slot available')
    }
    entered += 1
  }
  timings.queueMs = elapsedMs(queueStartedAt)

  let target: string | URL = request.url
  const visited = new Set<string>()

  // Each hop overwrites the connection phases, so the record describes the
  // final hop rather than mixing a fresh first connection into a reused last one.
  const recordConnection = (connection: HttpTimings): void => {
    delete timings.socketDnsMs
    delete timings.connectMs
    delete timings.tlsMs
    delete timings.ttfbMs
    timings.connectionReused = connection.connectionReused
    if (connection.socketDnsMs !== undefined) timings.socketDnsMs = connection.socketDnsMs
    if (connection.connectMs !== undefined) timings.connectMs = connection.connectMs
    if (connection.tlsMs !== undefined) timings.tlsMs = connection.tlsMs
    if (connection.ttfbMs !== undefined) timings.ttfbMs = connection.ttfbMs
  }

  for (let redirects = 0; ; redirects += 1) {
    timings.redirects = redirects
    const dnsStartedAt = performance.now()
    const destination = await validateDestination(target, context.policy, controller.signal)
    timings.dnsMs = (timings.dnsMs ?? 0) + elapsedMs(dnsStartedAt)
    if (abandoned) return fail(abandoned, abandonmentReason(abandoned))
    if (!destination.ok) {
      return fail(destination.code, destination.reason, { redirects })
    }

    const { url } = destination
    if (visited.has(url.href)) {
      return fail('redirect_loop', 'redirect returned to a URL already visited', { host: url.host, redirects })
    }
    visited.add(url.href)

    let response: Response
    try {
      response = await context.httpClient(
        new Request(url, { method: 'GET', headers, redirect: 'manual', signal: controller.signal }),
        recordConnection,
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
        return fail('invalid_redirect', `${response.status} without a location`, { host: url.host, redirects })
      }
      if (redirects >= maxRedirects) {
        controller.abort(new RetrievalError('too_many_redirects', 'redirect limit reached'))
        return fail('too_many_redirects', `more than ${maxRedirects} redirects`, { host: url.host, redirects })
      }

      try {
        target = new URL(location, url)
      } catch {
        return fail('invalid_redirect', 'unparseable redirect location', { host: url.host, redirects })
      }
      continue
    }

    const answered = { host: url.host, path: url.pathname, status: response.status, redirects }

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
        timings,
        body: emptyStream(),
      }
    }

    if (!response.ok) {
      await discard(response)
      controller.abort(new RetrievalError('http_error', `upstream answered ${response.status}`))
      return fail('http_error', `upstream answered ${response.status}`, answered, response.status)
    }

    const contentType = mediaType(response.headers.get('content-type'))
    if (!accepted(contentType, profile.accept)) {
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
      timings,
      body: boundedBody(response, {
        maxBytes,
        signal: controller.signal,
        abandonedKind: () => abandoned,
        abort: (error) => controller.abort(error),
        finish: (bytes, error) => {
          timings.bodyMs = elapsedMs(bodyStartedAt)
          timings.bytes = bytes
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
    return { ok: false, code, reason: describe(error), timings: result.timings }
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

function forwardableHeaders(
  supplied: Readonly<Record<string, string>> | undefined,
  acceptedTypes: readonly string[],
): Headers {
  const headers = new Headers()

  for (const [name, value] of Object.entries(supplied ?? {})) {
    const normalizedName = name.toLowerCase()
    if (hasOwn(FORWARDABLE_HEADERS, normalizedName)) headers.set(name, value)
  }
  headers.set('accept', acceptedTypes.join(', '))
  headers.set('user-agent', USER_AGENT)

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

  constructor(limit: number, queueLimit: number) {
    if (!Number.isSafeInteger(limit) || limit < 1 || !Number.isSafeInteger(queueLimit) || queueLimit < 0) {
      throw new Error('retrieval capacity must use finite non-negative integers')
    }
    this.#limit = limit
    this.#queueLimit = queueLimit
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

interface ResolvedLimits {
  readonly maxBytes: number
  readonly timeoutMs: number
  readonly bodyTimeoutMs: number
  readonly maxRedirects: number
}

function stricterLimits(profile: RetrievalProfile, requested: RetrievalLimits | undefined): ResolvedLimits | undefined {
  const values = [requested?.maxBytes, requested?.timeoutMs, requested?.bodyTimeoutMs, requested?.maxRedirects]
  if (values.some((value) => value !== undefined && !Number.isFinite(value))) return undefined

  return {
    maxBytes: Math.max(1, Math.min(Math.floor(requested?.maxBytes ?? profile.maxBytes), profile.maxBytes)),
    timeoutMs: Math.max(1, Math.min(Math.floor(requested?.timeoutMs ?? profile.timeoutMs), profile.timeoutMs)),
    bodyTimeoutMs: Math.max(
      1,
      Math.min(Math.floor(requested?.bodyTimeoutMs ?? profile.bodyTimeoutMs), profile.bodyTimeoutMs),
    ),
    maxRedirects: Math.max(
      0,
      Math.min(Math.floor(requested?.maxRedirects ?? profile.maxRedirects), profile.maxRedirects),
    ),
  }
}

function validCapacity(capacity: RetrievalCapacity): RetrievalCapacity {
  if (
    !Number.isSafeInteger(capacity.maxConcurrent) ||
    capacity.maxConcurrent < 1 ||
    !Number.isSafeInteger(capacity.maxQueued) ||
    capacity.maxQueued < 0
  ) {
    throw new Error('retrieval capacity must use finite non-negative integers')
  }
  return capacity
}

function gateFor(capacity: RetrievalCapacity): ConcurrencyGate {
  const valid = validCapacity(capacity)
  return new ConcurrencyGate(valid.maxConcurrent, valid.maxQueued)
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
    this.#gate = gateFor(capacity)
  }

  readonly resolve: ResolveAddresses = async (hostname, signal) => {
    const activeSignal = signal ?? new AbortController().signal
    if (!(await this.#gate.enter(activeSignal))) {
      if (activeSignal.aborted) throw activeSignal.reason
      throw new ResolutionCapacityError()
    }

    const resolution = Promise.resolve().then(() => this.#resolve(hostname, activeSignal))
    void resolution.finally(() => this.#gate.leave()).catch(() => {})

    if (activeSignal.aborted) throw activeSignal.reason
    return new Promise<readonly string[]>((resolve, reject) => {
      const onAbort = (): void => reject(activeSignal.reason)
      activeSignal.addEventListener('abort', onAbort, { once: true })
      resolution.then(resolve, reject).finally(() => activeSignal.removeEventListener('abort', onAbort))
    })
  }
}
