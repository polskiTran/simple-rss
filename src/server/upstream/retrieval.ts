import { VERSION } from '../../shared/version.js'
import type { Logger } from '../logger.js'
import {
  systemResolver,
  validateDestination,
  type DestinationPolicy,
  type ResolveAddresses,
} from './destination.js'
import type { HttpClient } from './http-client.js'

/**
 * The redirect ceiling. A caller may ask for fewer hops but never for more:
 * every hop is another destination to validate and another chance for a
 * publisher to walk the reader somewhere it should not go.
 */
export const MAX_REDIRECTS = 5

const DEFAULT_MAX_CONCURRENT = 6
const DEFAULT_MAX_QUEUED = 32

/**
 * The only request headers that reach a publisher. Everything else — the
 * Owner's session cookie, an `Authorization` header, the setup secret, the
 * page they came from — belongs to this installation and stays here.
 */
const FORWARDABLE_HEADERS = new Set([
  'accept',
  'accept-language',
  'if-modified-since',
  'if-none-match',
  'user-agent',
])

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308])

/** Why a retrieval did not produce bytes. One category per thing a caller can do about it. */
export type RetrievalFailureCode =
  | 'invalid_url'
  | 'blocked_destination'
  | 'unresolvable_host'
  | 'invalid_redirect'
  | 'too_many_redirects'
  | 'redirect_loop'
  | 'unsupported_content_type'
  | 'too_large'
  | 'http_error'
  | 'timeout'
  | 'cancelled'
  | 'busy'
  | 'unavailable'

export interface RetrievalRequest {
  readonly url: string | URL
  /** Names the caller in logs: `feed`, `reader`, `image`. */
  readonly operation: string
  /** Content types this caller can actually use. A response outside it is refused. */
  readonly accept: readonly string[]
  /** Decoded-byte ceiling. Streaming stops and the connection closes above it. */
  readonly maxBytes: number
  /** Total budget for resolution, connection, and the whole body. */
  readonly timeoutMs: number
  /** Defaults to, and is capped at, `MAX_REDIRECTS`. Zero refuses to follow any. */
  readonly maxRedirects?: number
  /** Filtered to `FORWARDABLE_HEADERS`; anything else is dropped. */
  readonly headers?: Readonly<Record<string, string>>
  /** Lets the caller abandon work whose answer nobody is waiting for. */
  readonly signal?: AbortSignal
}

export interface RetrievalSuccess {
  readonly ok: true
  readonly status: number
  /** Where the bytes came from, which is the last hop rather than what was asked for. */
  readonly url: string
  readonly contentType: string
  readonly etag: string | undefined
  readonly lastModified: string | undefined
  /** True when a conditional request was answered `304` and there is no body. */
  readonly notModified: boolean
  /**
   * Decoded bytes, bounded by `maxBytes`. Reading past the ceiling errors the
   * stream with a `RetrievalError` and closes the connection.
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

/** A share of the boundary's capacity, so one kind of work cannot starve another. */
export interface RetrievalBudget {
  readonly name: string
  readonly maxConcurrent: number
  readonly maxQueued?: number
}

export interface Retrieval {
  /** Streams the body. The caller must consume or cancel it, which frees the slot. */
  retrieve(request: RetrievalRequest): Promise<RetrievalResult>
  /** Buffers the body up to the ceiling, for callers that parse rather than relay. */
  retrieveBytes(request: RetrievalRequest): Promise<RetrievalBytesResult>
  /** A view of this boundary with its own concurrency budget and the same safety checks. */
  scoped(budget: RetrievalBudget): Retrieval
}

export interface RetrievalOptions {
  readonly httpClient: HttpClient
  readonly logger: Logger
  /** Defaults to the system resolver; injected so tests can move a name. */
  readonly resolve?: ResolveAddresses
  /** This installation's own origins, which are never retrievable. */
  readonly self?: readonly string[]
  readonly maxConcurrent?: number
  readonly maxQueued?: number
  readonly userAgent?: string
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
 * Feed polling, Reader extraction, and the image proxy all pass through here,
 * so the rules that keep an outward request safe are written once: HTTP only,
 * no credentials, no private or self-referencing destinations, every redirect
 * revalidated, one deadline covering the whole exchange, a decoded-byte
 * ceiling enforced while streaming rather than after, and a bounded number of
 * retrievals in flight.
 *
 * Callers choose the content types, ceiling, deadline, redirect policy, and
 * budget that suit their work. They cannot choose to skip a check, and there
 * is no way to ask this for an arbitrary URL on someone else's behalf: it
 * takes a URL the installation already decided to retrieve.
 */
export function createRetrieval(options: RetrievalOptions): Retrieval {
  const logger = options.logger.child({ component: 'upstream' })
  const userAgent = options.userAgent ?? `simple-rss/${VERSION}`
  const policy: DestinationPolicy = {
    resolve: options.resolve ?? systemResolver,
    ...(options.self ? { self: options.self } : {}),
  }
  const shared = new ConcurrencyGate(
    options.maxConcurrent ?? DEFAULT_MAX_CONCURRENT,
    options.maxQueued ?? DEFAULT_MAX_QUEUED,
  )

  function build(gates: readonly ConcurrencyGate[], budget: string | undefined): Retrieval {
    const retrieve = (request: RetrievalRequest): Promise<RetrievalResult> =>
      run(request, { httpClient: options.httpClient, logger, policy, userAgent, gates, budget })

    return {
      retrieve,
      retrieveBytes: async (request) => collect(await retrieve(request)),
      scoped: (nested) =>
        build(
          [...gates, new ConcurrencyGate(nested.maxConcurrent, nested.maxQueued ?? DEFAULT_MAX_QUEUED)],
          nested.name,
        ),
    }
  }

  return build([shared], undefined)
}

interface RunContext {
  readonly httpClient: HttpClient
  readonly logger: Logger
  readonly policy: DestinationPolicy
  readonly userAgent: string
  readonly gates: readonly ConcurrencyGate[]
  readonly budget: string | undefined
}

async function run(request: RetrievalRequest, context: RunContext): Promise<RetrievalResult> {
  const startedAt = process.hrtime.bigint()
  const maxRedirects = Math.max(0, Math.min(request.maxRedirects ?? MAX_REDIRECTS, MAX_REDIRECTS))
  const headers = forwardableHeaders(request.headers, context.userAgent)

  // One controller ends everything: the deadline, the caller giving up, and a
  // body that grows past its ceiling all abort the same in-flight request.
  const controller = new AbortController()
  let abandoned: 'timeout' | 'cancelled' | undefined
  const abort = (kind: 'timeout' | 'cancelled', message: string) => {
    abandoned ??= kind
    controller.abort(new RetrievalError(kind, message))
  }

  const timer = setTimeout(() => abort('timeout', `no answer within ${request.timeoutMs}ms`), request.timeoutMs)
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
      ...(context.budget ? { budget: context.budget } : {}),
      ...fields,
      durationMs: Math.round(Number(process.hrtime.bigint() - startedAt) / 1e4) / 100,
    })
  }

  const fail = (code: RetrievalFailureCode, reason: string, extra: Record<string, unknown> = {}): RetrievalFailure => {
    settle()
    log('upstream.retrieval_failed', { code, reason, ...extra })
    return { ok: false, code, reason, ...(typeof extra['status'] === 'number' ? { status: extra['status'] } : {}) }
  }

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
    const destination = await validateDestination(target, context.policy)
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

    const shape = { host: url.host, path: url.pathname, status: response.status, redirects }

    if (response.status === 304) {
      await discard(response)
      settle()
      log('upstream.retrieval_completed', { ...shape, bytes: 0, notModified: true })
      return {
        ok: true,
        status: 304,
        url: url.href,
        contentType: '',
        etag: response.headers.get('etag') ?? undefined,
        lastModified: response.headers.get('last-modified') ?? undefined,
        notModified: true,
        body: emptyStream(),
      }
    }

    if (!response.ok) {
      await discard(response)
      controller.abort(new RetrievalError('http_error', `upstream answered ${response.status}`))
      return fail('http_error', `upstream answered ${response.status}`, shape)
    }

    const contentType = essence(response.headers.get('content-type'))
    if (!accepted(contentType, request.accept)) {
      await discard(response)
      controller.abort(new RetrievalError('unsupported_content_type', 'unusable content type'))
      return fail('unsupported_content_type', contentType ? `content type ${contentType}` : 'no content type', shape)
    }

    const declared = Number(response.headers.get('content-length'))
    if (Number.isFinite(declared) && declared > request.maxBytes) {
      await discard(response)
      controller.abort(new RetrievalError('too_large', 'declared length above the ceiling'))
      return fail('too_large', `declared ${declared} bytes above the ${request.maxBytes} ceiling`, shape)
    }

    return {
      ok: true,
      status: response.status,
      url: url.href,
      contentType,
      etag: response.headers.get('etag') ?? undefined,
      lastModified: response.headers.get('last-modified') ?? undefined,
      notModified: false,
      body: boundedBody(response, {
        maxBytes: request.maxBytes,
        signal: controller.signal,
        abandonedKind: () => abandoned,
        abort: (error) => controller.abort(error),
        finish: (bytes, error) => {
          settle()
          if (error) log('upstream.retrieval_failed', { ...shape, code: error.code, reason: error.message, bytes })
          else log('upstream.retrieval_completed', { ...shape, bytes, notModified: false })
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
 * Keeps only headers a publisher has any business seeing, and always identifies
 * the reader so an operator on the other end can recognise the traffic.
 */
function forwardableHeaders(supplied: Readonly<Record<string, string>> | undefined, userAgent: string): Headers {
  const headers = new Headers({ 'user-agent': userAgent })

  for (const [name, value] of Object.entries(supplied ?? {})) {
    if (FORWARDABLE_HEADERS.has(name.toLowerCase())) headers.set(name, value)
  }

  return headers
}

function essence(contentType: string | null): string {
  return (contentType ?? '').split(';')[0]?.trim().toLowerCase() ?? ''
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
    this.#limit = Math.max(1, limit)
    this.#queueLimit = Math.max(0, queueLimit)
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
