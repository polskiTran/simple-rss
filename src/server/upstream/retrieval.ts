import { MAX_FEED_SIZE_MIB } from '../../shared/api.js'
import { VERSION } from '../../shared/version.js'
import type { Logger } from '../logger.js'
import {
  ResolutionCapacityError,
  systemResolver,
  validateDestination,
  type DestinationPolicy,
  type ResolveAddresses,
} from './destination.js'
import { HttpClientError, type HttpClient } from './http-client.js'
import { createNetworkHttpClient } from './network-client.js'

export const MAX_REDIRECTS = 5

export type RetrievalOperation = 'feed' | 'reader' | 'image' | 'preview' | 'discovery'

export interface RetrievalCapacity {
  readonly maxConcurrent: number
  readonly maxQueued: number
}

/**
 * How a profile keeps time. `split` gives the answer and its body separate
 * clocks, so a slow large body is not an unreachable host; `total` runs one
 * clock from queueing through the last decoded byte.
 */
export type RetrievalDeadline =
  | {
      readonly kind: 'split'
      /** Covers resolution, connection, every redirect hop, and the final response headers. */
      readonly timeoutMs: number
      readonly bodyTimeoutMs: number
    }
  | { readonly kind: 'total'; readonly timeoutMs: number }

export interface RetrievalProfile {
  readonly accept: readonly string[]
  readonly maxBytes: number
  /** Past `maxBytes`: `refuse` fails `too_large`; `truncate` ends the body cleanly at the ceiling. */
  readonly pastCeiling: 'refuse' | 'truncate'
  readonly deadline: RetrievalDeadline
  readonly maxRedirects: number
  readonly capacity: RetrievalCapacity
}

const FEED_CONTENT_TYPES = ['application/rss+xml', 'application/atom+xml', 'application/xml', 'text/xml']
const PAGE_CONTENT_TYPES = ['text/html', 'application/xhtml+xml']

export const RETRIEVAL_PROFILES: Readonly<Record<RetrievalOperation, RetrievalProfile>> = {
  feed: {
    accept: FEED_CONTENT_TYPES,
    maxBytes: MAX_FEED_SIZE_MIB * 1024 * 1024,
    pastCeiling: 'refuse',
    deadline: { kind: 'split', timeoutMs: 10_000, bodyTimeoutMs: 60_000 },
    maxRedirects: MAX_REDIRECTS,
    capacity: { maxConcurrent: 4, maxQueued: 24 },
  },
  reader: {
    accept: PAGE_CONTENT_TYPES,
    maxBytes: 5 * 1024 * 1024,
    pastCeiling: 'refuse',
    deadline: { kind: 'split', timeoutMs: 10_000, bodyTimeoutMs: 30_000 },
    maxRedirects: MAX_REDIRECTS,
    capacity: { maxConcurrent: 2, maxQueued: 8 },
  },
  image: {
    accept: ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif'],
    maxBytes: 5 * 1024 * 1024,
    pastCeiling: 'refuse',
    deadline: { kind: 'split', timeoutMs: 10_000, bodyTimeoutMs: 30_000 },
    maxRedirects: MAX_REDIRECTS,
    capacity: { maxConcurrent: 4, maxQueued: 16 },
  },
  /** A pasted address proven before it is recorded: the Feed profile under one clock a User is waiting on. */
  preview: {
    accept: FEED_CONTENT_TYPES,
    maxBytes: MAX_FEED_SIZE_MIB * 1024 * 1024,
    pastCeiling: 'refuse',
    deadline: { kind: 'total', timeoutMs: 15_000 },
    maxRedirects: MAX_REDIRECTS,
    capacity: { maxConcurrent: 2, maxQueued: 4 },
  },
  /** A pasted page read for its Declared Feeds; they sit in the head, so the tail past the ceiling is dropped. */
  discovery: {
    accept: PAGE_CONTENT_TYPES,
    maxBytes: 1024 * 1024,
    pastCeiling: 'truncate',
    deadline: { kind: 'total', timeoutMs: 15_000 },
    maxRedirects: MAX_REDIRECTS,
    capacity: { maxConcurrent: 2, maxQueued: 4 },
  },
}

/**
 * DNS is budgeted apart from the operations: every one of them at full tilt
 * can be resolving at once, and the queue absorbs lookups that outlived the
 * retrieval that asked for them.
 */
const RESOLUTION_CAPACITY: RetrievalCapacity = {
  maxConcurrent: Object.values(RETRIEVAL_PROFILES).reduce(
    (total, profile) => total + profile.capacity.maxConcurrent,
    0,
  ),
  maxQueued: 32,
}

/** Can only tighten the operation profile; non-finite values are rejected. */
export interface RetrievalLimits {
  readonly maxBytes?: number
  /** On a `total` deadline this tightens the whole retrieval, body included. */
  readonly timeoutMs?: number
  /** Only a `split` deadline has a body clock; a `total` one ignores this. */
  readonly bodyTimeoutMs?: number
  readonly maxRedirects?: number
}

const FORWARDABLE_HEADERS: Readonly<Record<string, true>> = {
  'accept-language': true,
  'if-modified-since': true,
  'if-none-match': true,
}

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
  /** The publisher never answered — or, under a `total` deadline, never finished. */
  | 'timeout'
  /** Answered, but the body did not finish arriving; only a `split` deadline says this. */
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
  /** Past the profile's byte ceiling the stream errors with a `RetrievalError`, or closes if the profile truncates. */
  readonly body: ReadableStream<Uint8Array>
}

export interface RetrievalFailure {
  readonly ok: false
  readonly code: RetrievalFailureCode
  /** Safe for logs and never shown raw to the User. */
  readonly reason: string
  /** Present for `http_error`, so a caller can tell 404 from 503. */
  readonly status?: number
  /** Present for `unsupported_content_type`: the media type seen, `''` when none was declared. */
  readonly contentType?: string
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
  readonly operationCapacity?: Partial<Record<RetrievalOperation, RetrievalCapacity>>
  readonly resolutionCapacity?: RetrievalCapacity
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
  const resolver = new BoundedResolver(
    options.resolve ?? systemResolver,
    options.resolutionCapacity ?? RESOLUTION_CAPACITY,
  )
  const policy: DestinationPolicy = { resolve: resolver.resolve, self: options.self }
  const gates: Record<RetrievalOperation, ConcurrencyGate> = {
    feed: new ConcurrencyGate(options.operationCapacity?.feed ?? RETRIEVAL_PROFILES.feed.capacity),
    reader: new ConcurrencyGate(options.operationCapacity?.reader ?? RETRIEVAL_PROFILES.reader.capacity),
    image: new ConcurrencyGate(options.operationCapacity?.image ?? RETRIEVAL_PROFILES.image.capacity),
    preview: new ConcurrencyGate(options.operationCapacity?.preview ?? RETRIEVAL_PROFILES.preview.capacity),
    discovery: new ConcurrencyGate(options.operationCapacity?.discovery ?? RETRIEVAL_PROFILES.discovery.capacity),
  }

  const retrieve = (request: RetrievalRequest): Promise<RetrievalResult> =>
    run(request, {
      httpClient: options.httpClient,
      logger,
      policy,
      gate: gates[request.operation],
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
  readonly gate: ConcurrencyGate
}

async function run(request: RetrievalRequest, context: RunContext): Promise<RetrievalResult> {
  const startedAt = process.hrtime.bigint()
  const profile = RETRIEVAL_PROFILES[request.operation]
  const limits = stricterLimits(profile, request.limits)
  const maxRedirects = limits?.maxRedirects ?? profile.maxRedirects
  const maxBytes = limits?.maxBytes ?? profile.maxBytes
  const deadline = limits?.deadline ?? profile.deadline
  const headers = forwardableHeaders(request.headers, profile.accept)

  const controller = new AbortController()
  let abandoned: Abandonment | undefined
  const abort = (kind: Abandonment, message: string) => {
    abandoned ??= kind
    controller.abort(new RetrievalError(kind, message))
  }

  let timer = setTimeout(
    () =>
      abort(
        'timeout',
        deadline.kind === 'total'
          ? `unfinished within ${deadline.timeoutMs}ms`
          : `no answer within ${deadline.timeoutMs}ms`,
      ),
    deadline.timeoutMs,
  )

  // A `total` deadline keeps running; only a `split` one hands the body its own clock.
  const startBodyDeadline = (): void => {
    if (deadline.kind !== 'split') return
    clearTimeout(timer)
    const { bodyTimeoutMs } = deadline
    timer = setTimeout(() => abort('body_timeout', `body unfinished after ${bodyTimeoutMs}ms`), bodyTimeoutMs)
  }

  const onCancel = () => abort('cancelled', 'caller abandoned the retrieval')
  request.signal?.addEventListener('abort', onCancel, { once: true })

  let entered = false
  let settled = false

  const settle = (): void => {
    if (settled) return
    settled = true
    clearTimeout(timer)
    request.signal?.removeEventListener('abort', onCancel)
    if (entered) context.gate.leave()
  }

  const log = (event: string, fields: Record<string, unknown>): void => {
    const level = event === 'upstream.retrieval_completed' ? 'debug' : 'warn'
    context.logger[level](event, {
      operation: request.operation,
      ...fields,
      durationMs: Math.round(Number(process.hrtime.bigint() - startedAt) / 1e4) / 100,
    })
  }

  const fail = (
    code: RetrievalFailureCode,
    reason: string,
    fields: Record<string, unknown> = {},
    detail: Pick<RetrievalFailure, 'status' | 'contentType'> = {},
  ): RetrievalFailure => {
    settle()
    log('upstream.retrieval_failed', { code, reason, ...fields, ...detail })
    return { ok: false, code, reason, ...detail }
  }

  if (!limits) return fail('invalid_request', 'retrieval limits must be finite numbers')

  if (request.signal?.aborted) return fail('cancelled', 'caller abandoned the retrieval')

  if (!(await context.gate.enter(controller.signal))) {
    return abandoned
      ? fail(abandoned, 'gave up waiting for a retrieval slot')
      : fail('busy', 'no retrieval slot available')
  }
  entered = true

  let target: string | URL = request.url
  const visited = new Set<string>()

  for (let redirects = 0; ; redirects += 1) {
    const destination = await validateDestination(target, context.policy, controller.signal)
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
        body: emptyStream(),
      }
    }

    if (!response.ok) {
      await discard(response)
      controller.abort(new RetrievalError('http_error', `upstream answered ${response.status}`))
      return fail('http_error', `upstream answered ${response.status}`, answered, { status: response.status })
    }

    const contentType = mediaType(response.headers.get('content-type'))
    if (!accepted(contentType, profile.accept)) {
      await discard(response)
      controller.abort(new RetrievalError('unsupported_content_type', 'unusable content type'))
      const reason = contentType ? `content type ${contentType}` : 'no content type'
      return fail('unsupported_content_type', reason, answered, { contentType })
    }

    const declared = Number(response.headers.get('content-length'))
    if (profile.pastCeiling === 'refuse' && Number.isFinite(declared) && declared > maxBytes) {
      await discard(response)
      controller.abort(new RetrievalError('too_large', 'declared length above the ceiling'))
      return fail('too_large', `declared ${declared} bytes above the ${maxBytes} ceiling`, answered)
    }

    startBodyDeadline()
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
        pastCeiling: profile.pastCeiling,
        signal: controller.signal,
        abandonedKind: () => abandoned,
        abort: (error) => controller.abort(error),
        finish: (outcome) => {
          settle()
          if (outcome.error) {
            const { error, bytes } = outcome
            log('upstream.retrieval_failed', { ...answered, code: error.code, reason: error.message, bytes })
          } else {
            log('upstream.retrieval_completed', { ...answered, ...outcome, notModified: false })
          }
        },
      }),
    }
  }
}

type BodyOutcome =
  | { readonly bytes: number; readonly truncated?: true; readonly error?: undefined }
  | { readonly bytes: number; readonly error: RetrievalError }

interface BoundedBodyOptions {
  readonly maxBytes: number
  readonly pastCeiling: RetrievalProfile['pastCeiling']
  readonly signal: AbortSignal
  readonly abandonedKind: () => Abandonment | undefined
  readonly abort: (error: RetrievalError) => void
  readonly finish: (outcome: BodyOutcome) => void
}

/**
 * Counts decoded bytes and tears the connection down past the ceiling —
 * erroring the stream, or closing it on the ceiling's last byte when the
 * profile truncates. `Content-Length` is only a hint: compressed bodies expand
 * and hostile ones lie.
 */
function boundedBody(response: Response, options: BoundedBodyOptions): ReadableStream<Uint8Array> {
  const source = response.body
  if (!source) {
    options.finish({ bytes: 0 })
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
    options.finish(error ? { bytes: seen, error } : { bytes: seen })
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
            options.finish({ bytes: seen })
          }
          controller.close()
          return
        }

        seen += chunk.value.byteLength
        if (seen > options.maxBytes) {
          if (options.pastCeiling === 'refuse') {
            stop(new RetrievalError('too_large', `body passed the ${options.maxBytes} byte ceiling`))
            return
          }
          const kept = chunk.value.subarray(0, chunk.value.byteLength - (seen - options.maxBytes))
          seen = options.maxBytes
          done = true
          void reader.cancel().catch(() => {})
          if (kept.byteLength > 0) controller.enqueue(kept)
          controller.close()
          options.finish({ bytes: seen, truncated: true })
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

function forwardableHeaders(
  supplied: Readonly<Record<string, string>> | undefined,
  acceptedTypes: readonly string[],
): Headers {
  const headers = new Headers()

  for (const [name, value] of Object.entries(supplied ?? {})) {
    if (FORWARDABLE_HEADERS[name.toLowerCase()]) headers.set(name, value)
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

function describe(error: unknown): string {
  if (error instanceof Error) return error.message
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

interface ResolvedLimits {
  readonly maxBytes: number
  readonly deadline: RetrievalDeadline
  readonly maxRedirects: number
}

function stricterLimits(profile: RetrievalProfile, requested: RetrievalLimits | undefined): ResolvedLimits | undefined {
  const values = [requested?.maxBytes, requested?.timeoutMs, requested?.bodyTimeoutMs, requested?.maxRedirects]
  if (values.some((value) => value !== undefined && !Number.isFinite(value))) return undefined

  const { deadline } = profile
  const timeoutMs = tightened(requested?.timeoutMs, deadline.timeoutMs, 1)
  return {
    maxBytes: tightened(requested?.maxBytes, profile.maxBytes, 1),
    deadline:
      deadline.kind === 'total'
        ? { kind: 'total', timeoutMs }
        : { kind: 'split', timeoutMs, bodyTimeoutMs: tightened(requested?.bodyTimeoutMs, deadline.bodyTimeoutMs, 1) },
    maxRedirects: tightened(requested?.maxRedirects, profile.maxRedirects, 0),
  }
}

/** The profile's value is the ceiling; a request can only come down from it. */
function tightened(requested: number | undefined, ceiling: number, floor: number): number {
  return Math.max(floor, Math.min(Math.floor(requested ?? ceiling), ceiling))
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
