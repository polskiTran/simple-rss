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

/** No retrieval may follow more than five redirects. */
export const MAX_REDIRECTS = 5

const DEFAULT_CAPACITY: RetrievalCapacity = { maxConcurrent: 6, maxQueued: 32 }

/** The three intentional reasons Simple RSS retrieves outside content. */
export type RetrievalOperation = 'feed' | 'reader' | 'image'

/** Total active and waiting work allowed through one concurrency gate. */
export interface RetrievalCapacity {
  readonly maxConcurrent: number
  readonly maxQueued: number
}

export interface RetrievalProfile {
  readonly accept: readonly string[]
  readonly maxBytes: number
  readonly timeoutMs: number
  readonly maxRedirects: number
  readonly capacity: RetrievalCapacity
}

/**
 * Safety policy belongs here rather than at each caller. A caller names its
 * operation and may ask for a stricter limit, but can never broaden a profile.
 */
export const RETRIEVAL_PROFILES: Readonly<Record<RetrievalOperation, RetrievalProfile>> = {
  feed: {
    accept: ['application/rss+xml', 'application/atom+xml', 'application/xml', 'text/xml'],
    maxBytes: 2 * 1024 * 1024,
    timeoutMs: 10_000,
    maxRedirects: MAX_REDIRECTS,
    capacity: { maxConcurrent: 4, maxQueued: 24 },
  },
  reader: {
    accept: ['text/html', 'application/xhtml+xml'],
    maxBytes: 5 * 1024 * 1024,
    timeoutMs: 10_000,
    maxRedirects: MAX_REDIRECTS,
    capacity: { maxConcurrent: 2, maxQueued: 8 },
  },
  image: {
    accept: ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif'],
    maxBytes: 5 * 1024 * 1024,
    timeoutMs: 10_000,
    maxRedirects: MAX_REDIRECTS,
    capacity: { maxConcurrent: 4, maxQueued: 16 },
  },
}

/**
 * Optional limits can only make the selected operation profile stricter.
 * Non-finite values are rejected instead of defeating comparisons.
 */
export interface RetrievalLimits {
  readonly maxBytes?: number
  readonly timeoutMs?: number
  readonly maxRedirects?: number
}

/**
 * The only request headers that reach a publisher. Everything else — the
 * Owner's Session cookie, an `Authorization` header, the Setup Secret, and the
 * page they came from — belongs to this installation and stays here.
 */
const FORWARDABLE_HEADERS: Readonly<Record<string, true>> = {
  'accept-language': true,
  'if-modified-since': true,
  'if-none-match': true,
}

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308])

/** How this reader identifies itself, so an operator can recognise its traffic. */
const USER_AGENT = `simple-rss/${VERSION}`

/** Why a retrieval did not produce bytes. One category per caller response. */
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
  | 'timeout'
  | 'cancelled'
  | 'busy'
  | 'unavailable'

export interface RetrievalRequest {
  readonly url: string | URL
  /** Selects the module-owned content, resource, redirect, and capacity policy. */
  readonly operation: RetrievalOperation
  /** Filtered to `FORWARDABLE_HEADERS`; anything else is dropped. */
  readonly headers?: Readonly<Record<string, string>>
  /** Lets the caller abandon work whose answer nobody is waiting for. */
  readonly signal?: AbortSignal
  /** Optional stricter limits; values above the profile are clamped. */
  readonly limits?: RetrievalLimits
}

export interface RetrievalSuccess {
  readonly ok: true
  readonly status: number
  /** Where the bytes came from, which is the last hop rather than what was asked for. */
  readonly url: string
  readonly contentType: string
  /** The `charset` parameter the publisher declared alongside it, if any. */
  readonly charset: string | undefined
  readonly etag: string | undefined
  readonly lastModified: string | undefined
  /** True when a conditional request was answered `304` and there is no body. */
  readonly notModified: boolean
  /**
   * Decoded bytes, bounded by the selected profile. Reading past the ceiling
   * errors the stream with a `RetrievalError` and closes the connection.
   */
  readonly body: ReadableStream<Uint8Array>
}

export interface RetrievalFailure {
  readonly ok: false
  readonly code: RetrievalFailureCode
  /** Safe for logs and never shown raw to the Owner. */
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
  /** Streams the body. The caller must consume or cancel it, which frees the slot. */
  retrieve(request: RetrievalRequest): Promise<RetrievalResult>
  /** Buffers the body up to the selected profile's ceiling. */
  retrieveBytes(request: RetrievalRequest): Promise<RetrievalBytesResult>
}

interface RetrievalOptions {
  readonly httpClient: HttpClient
  readonly logger: Logger
  /** Internal test seam; production uses the system resolver. */
  readonly resolve?: ResolveAddresses
  /** The installation's required canonical public origin. */
  readonly self: URL
  /** Internal test seam; production uses `DEFAULT_CAPACITY`. */
  readonly capacity?: RetrievalCapacity
  /** Internal test seam for exercising per-operation saturation. */
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
 * The one door to the outside world.
 *
 * Callers state whether they need a Feed, Reader, or image retrieval. This
 * module owns each operation's content, resource, redirect, and capacity
 * policy, plus the checks shared by every operation.
 */
export function createRetrieval(options: RetrievalOptions): Retrieval {
  const logger = options.logger.child({ component: 'upstream' })
  const sharedCapacity = validCapacity(options.capacity ?? DEFAULT_CAPACITY)
  const resolver = new BoundedResolver(options.resolve ?? systemResolver, sharedCapacity)
  const policy: DestinationPolicy = { resolve: resolver.resolve, self: options.self }
  const shared = new ConcurrencyGate(sharedCapacity.maxConcurrent, sharedCapacity.maxQueued)
  const operationGates: Record<RetrievalOperation, ConcurrencyGate> = {
    feed: gateFor(options.operationCapacity?.feed ?? RETRIEVAL_PROFILES.feed.capacity),
    reader: gateFor(options.operationCapacity?.reader ?? RETRIEVAL_PROFILES.reader.capacity),
    image: gateFor(options.operationCapacity?.image ?? RETRIEVAL_PROFILES.image.capacity),
  }

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

/** Production factory: raw transport details stay inside the retrieval module. */
export function createNetworkRetrieval(options: { readonly logger: Logger; readonly self: URL }): Retrieval {
  return createRetrieval({
    httpClient: createNetworkHttpClient(),
    logger: options.logger,
    self: options.self,
  })
}

interface RunContext {
  readonly httpClient: HttpClient
  readonly logger: Logger
  readonly policy: DestinationPolicy
  readonly gates: readonly ConcurrencyGate[]
}

async function run(request: RetrievalRequest, context: RunContext): Promise<RetrievalResult> {
  const startedAt = process.hrtime.bigint()
  const profile = RETRIEVAL_PROFILES[request.operation]
  const limits = stricterLimits(profile, request.limits)
  const maxRedirects = limits?.maxRedirects ?? profile.maxRedirects
  const maxBytes = limits?.maxBytes ?? profile.maxBytes
  const timeoutMs = limits?.timeoutMs ?? profile.timeoutMs
  const headers = forwardableHeaders(request.headers, profile.accept)

  // One controller ends everything: the deadline, the caller giving up, and a
  // body that grows past its ceiling all abort the same in-flight request.
  const controller = new AbortController()
  let abandoned: 'timeout' | 'cancelled' | undefined
  const abort = (kind: 'timeout' | 'cancelled', message: string) => {
    abandoned ??= kind
    controller.abort(new RetrievalError(kind, message))
  }

  const timer = setTimeout(() => abort('timeout', `no answer within ${timeoutMs}ms`), timeoutMs)
  const onCancel = () => abort('cancelled', 'caller abandoned the retrieval')
  request.signal?.addEventListener('abort', onCancel, { once: true })

  let entered = 0
  let settled = false

  /** Runs once, whether the retrieval failed early or its body finished later. */
  const settle = (): void => {
    if (settled) return
    settled = true
    clearTimeout(timer)
    request.signal?.removeEventListener('abort', onCancel)
    for (let index = entered - 1; index >= 0; index -= 1) context.gates[index]?.leave()
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
    status?: number,
  ): RetrievalFailure => {
    settle()
    log('upstream.retrieval_failed', { code, reason, ...fields })
    return { ok: false, code, reason, ...(status === undefined ? {} : { status }) }
  }

  if (!limits) return fail('invalid_request', 'retrieval limits must be finite numbers')

  if (request.signal?.aborted) return fail('cancelled', 'caller abandoned the retrieval')

  for (const gate of context.gates) {
    if (!(await gate.enter(controller.signal))) {
      return abandoned
        ? fail(abandoned, `gave up waiting for a retrieval slot`)
        : fail('busy', 'no retrieval slot available')
    }
    entered += 1
  }

  let target: string | URL = request.url
  const visited = new Set<string>()

  for (let redirects = 0; ; redirects += 1) {
    const destination = await validateDestination(target, context.policy, controller.signal)
    if (abandoned) {
      return fail(abandoned, abandoned === 'timeout' ? 'no answer in time' : 'caller abandoned the retrieval')
    }
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
      if (abandoned) {
        return fail(abandoned, abandoned === 'timeout' ? 'no answer in time' : 'caller abandoned the retrieval', {
          host: url.host,
        })
      }
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

    // What every log record about this answer says, minus the query string.
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
      return fail('http_error', `upstream answered ${response.status}`, answered, response.status)
    }

    const contentType = mediaType(response.headers.get('content-type'))
    if (!accepted(contentType, profile.accept)) {
      await discard(response)
      controller.abort(new RetrievalError('unsupported_content_type', 'unusable content type'))
      return fail(
        'unsupported_content_type',
        contentType ? `content type ${contentType}` : 'no content type',
        answered,
      )
    }

    const declared = Number(response.headers.get('content-length'))
    if (Number.isFinite(declared) && declared > maxBytes) {
      await discard(response)
      controller.abort(new RetrievalError('too_large', 'declared length above the ceiling'))
      return fail('too_large', `declared ${declared} bytes above the ${maxBytes} ceiling`, answered)
    }

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
  /** Aborted by the deadline, the caller, or the ceiling. */
  readonly signal: AbortSignal
  readonly abandonedKind: () => 'timeout' | 'cancelled' | undefined
  readonly abort: (error: RetrievalError) => void
  readonly finish: (bytes: number, error: RetrievalError | undefined) => void
}

/**
 * Counts decoded bytes as they arrive and tears the connection down the moment
 * the ceiling is passed. A `Content-Length` is only a hint — a compressed body
 * expands past it and a hostile one lies outright — so the count, not the
 * header, is what stops the read.
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

  const stop = (error: RetrievalError | undefined): void => {
    if (done) return
    done = true
    if (error) options.abort(error)
    void reader.cancel(error).catch(() => {})
    options.finish(seen, error)
  }

  // The deadline can pass while nobody is reading, and a stream that is never
  // pulled would otherwise hold its slot until someone remembered it.
  options.signal.addEventListener(
    'abort',
    () => {
      const reason = options.signal.reason
      stop(
        reason instanceof RetrievalError
          ? reason
          : new RetrievalError(options.abandonedKind() ?? 'cancelled', 'the retrieval was abandoned'),
      )
    },
    { once: true },
  )

  return new ReadableStream<Uint8Array>({
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
          const error = new RetrievalError('too_large', `body passed the ${options.maxBytes} byte ceiling`)
          stop(error)
          controller.error(error)
          return
        }

        controller.enqueue(chunk.value)
      } catch (cause) {
        const abandoned = options.abandonedKind()
        const error =
          cause instanceof RetrievalError
            ? cause
            : new RetrievalError(abandoned ?? 'unavailable', describe(cause))
        stop(error)
        controller.error(error)
      }
    },
    cancel(reason) {
      stop(reason instanceof RetrievalError ? reason : new RetrievalError('cancelled', 'body was cancelled'))
    },
  })
}

/** Buffers a streamed success, turning a stream failure back into a category. */
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

/**
 * Keeps only headers a publisher has any business seeing. The operation
 * profile owns `Accept`, and the module owns its identity.
 */
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

/** The media type without its parameters: `text/html; charset=utf-8` is `text/html`. */
function mediaType(contentType: string | null): string {
  return (contentType ?? '').split(';')[0]?.trim().toLowerCase() ?? ''
}

/** The declared text encoding, for callers that must decode what they read. */
function charsetOf(contentType: string | null): string | undefined {
  const charset = /;\s*charset\s*=\s*"?([\w-]+)"?/i.exec(contentType ?? '')?.[1]
  return charset?.toLowerCase()
}

function accepted(contentType: string, accept: readonly string[]): boolean {
  if (contentType === '') return false
  return accept.some((allowed) => allowed.trim().toLowerCase() === contentType)
}

/** Releases a response nobody will read, so the socket does not linger. */
async function discard(response: Response): Promise<void> {
  try {
    await response.body?.cancel()
  } catch {
    // A body that already failed needs no further disposal.
  }
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

/**
 * Bounded in-flight work with a bounded queue behind it.
 *
 * The queue matters as much as the limit: without it a burst of polls would
 * pile up holding deadlines, timers, and memory for answers nobody is waiting
 * for any more. Past the queue the honest answer is that the boundary is busy.
 */
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

  /** Resolves true holding a slot, false when the boundary is full or the caller gave up. */
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

  /** Hands the slot to whoever is next rather than releasing and re-taking it. */
  leave(): void {
    const next = this.#waiting.shift()
    if (next) next(true)
    else this.#active = Math.max(0, this.#active - 1)
  }
}

interface ResolvedLimits {
  readonly maxBytes: number
  readonly timeoutMs: number
  readonly maxRedirects: number
}

function stricterLimits(
  profile: RetrievalProfile,
  requested: RetrievalLimits | undefined,
): ResolvedLimits | undefined {
  const values = [requested?.maxBytes, requested?.timeoutMs, requested?.maxRedirects]
  if (values.some((value) => value !== undefined && !Number.isFinite(value))) return undefined

  return {
    maxBytes: Math.max(1, Math.min(Math.floor(requested?.maxBytes ?? profile.maxBytes), profile.maxBytes)),
    timeoutMs: Math.max(1, Math.min(Math.floor(requested?.timeoutMs ?? profile.timeoutMs), profile.timeoutMs)),
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
 * A caller stops waiting at its deadline, while the DNS gate remains occupied
 * until the underlying lookup actually settles. A broken resolver therefore
 * cannot create an unbounded pile of abandoned operating-system lookups.
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
