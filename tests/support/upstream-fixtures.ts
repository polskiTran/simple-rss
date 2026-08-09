import type { ResolveAddresses } from '../../src/server/upstream/destination.js'
import type { HttpClient } from '../../src/server/upstream/http-client.js'

/** The public address every stubbed host answers with. */
const STUBBED_HOST_ADDRESS = '93.184.216.34'

export interface FixtureResponse {
  readonly status?: number
  readonly headers?: Record<string, string>
  readonly body?: string | Uint8Array | ReadableStream<Uint8Array>
  /**
   * Held before the response arrives, so a test can drive a timeout or a
   * cancellation without waiting on a real network.
   */
  readonly delayMs?: number
}

export interface RecordedRequest {
  readonly method: string
  readonly url: string
  readonly headers: Record<string, string>
}

/**
 * Stands in for the outside world. Every upstream retrieval — Feeds, Reader
 * pages, proxied images — goes through the injected `HttpClient`, so a test
 * declares the bytes a publisher would return and asserts on what was asked.
 *
 * An unstubbed URL throws rather than escaping to the network, which keeps the
 * suite from depending on someone else's uptime.
 */
export class UpstreamFixtures {
  readonly #responses = new Map<string, FixtureResponse | (() => FixtureResponse)>()
  readonly #requests: RecordedRequest[] = []
  readonly #aborted: string[] = []

  /** Stubs one exact URL. Later calls to the same URL replace the earlier one. */
  stub(url: string, response: FixtureResponse): this {
    this.#responses.set(url, response)
    return this
  }

  /** Stubs a URL whose response changes between calls, e.g. a growing Feed. */
  stubDynamic(url: string, respond: () => FixtureResponse): this {
    this.#responses.set(url, respond)
    return this
  }

  get requests(): readonly RecordedRequest[] {
    return this.#requests
  }

  requestsTo(url: string): readonly RecordedRequest[] {
    return this.#requests.filter((request) => request.url === url)
  }

  /**
   * URLs whose request was abandoned by the caller. A retrieval that gives up
   * must tear its connection down rather than leave it running, and this is
   * how a test sees that happen.
   */
  get aborted(): readonly string[] {
    return this.#aborted
  }

  /**
   * DNS for the stubbed world. A host something is stubbed for resolves to one
   * ordinary public address; anything else resolves to nothing, so a test that
   * forgot a stub fails as an unresolvable host rather than by asking the real
   * resolver about a name that may or may not exist.
   */
  get resolve(): ResolveAddresses {
    return async (hostname) => {
      const known = [...this.#responses.keys()].some((url) => safeHostname(url) === hostname)
      return known ? [STUBBED_HOST_ADDRESS] : []
    }
  }

  get client(): HttpClient {
    return async (request) => {
      this.#requests.push({
        method: request.method,
        url: request.url,
        headers: Object.fromEntries(request.headers.entries()),
      })

      const stubbed = this.#responses.get(request.url)
      if (!stubbed) {
        throw new Error(
          `No upstream fixture for ${request.method} ${request.url}. ` +
            `Stub it with upstream.stub(url, { body }) — tests never reach the network.`,
        )
      }

      const { status = 200, headers = {}, body = '', delayMs } = typeof stubbed === 'function' ? stubbed() : stubbed
      const signal = request.signal
      signal?.addEventListener('abort', () => this.#aborted.push(request.url), { once: true })

      if (signal?.aborted) throw abortReason(signal)
      if (delayMs !== undefined) await this.#hold(delayMs, signal)

      // `304` and friends carry no body at all, and `Response` refuses to
      // pretend otherwise.
      const carriesBody = status !== 204 && status !== 205 && status !== 304
      return new Response(carriesBody ? (body as BodyInit) : null, { status, headers })
    }
  }

  /** Waits, unless the caller gives up first — exactly as a slow host would. */
  async #hold(delayMs: number, signal: AbortSignal | null): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        signal?.removeEventListener('abort', onAbort)
        resolve()
      }, delayMs)

      function onAbort(): void {
        clearTimeout(timer)
        reject(abortReason(signal))
      }

      signal?.addEventListener('abort', onAbort, { once: true })
    })
  }
}

/** A stream that yields the given chunks, so a test can watch bytes arrive. */
export function chunkedBody(chunks: readonly Uint8Array[]): ReadableStream<Uint8Array> {
  let index = 0
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      const chunk = chunks[index]
      index += 1
      if (chunk === undefined) controller.close()
      else controller.enqueue(chunk)
    },
  })
}

export interface PacedBodyOptions {
  /** How long the publisher pauses between chunks. */
  readonly gapMs: number
  /**
   * Whether the body ever finishes. `false` is a publisher that answered,
   * sent some of what it promised, and then went quiet without closing.
   */
  readonly ends?: boolean
}

/**
 * A body that arrives steadily but slowly, so a test can tell the wait for an
 * answer apart from the wait for that answer to finish.
 */
export function pacedBody(chunks: readonly Uint8Array[], options: PacedBodyOptions): ReadableStream<Uint8Array> {
  let index = 0
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      await new Promise((resolve) => setTimeout(resolve, options.gapMs))
      const chunk = chunks[index]
      index += 1
      if (chunk !== undefined) controller.enqueue(chunk)
      else if (options.ends ?? true) controller.close()
      else await new Promise(() => {})
    },
  })
}

function safeHostname(url: string): string | undefined {
  try {
    return new URL(url).hostname
  } catch {
    return undefined
  }
}

function abortReason(signal: AbortSignal | null): unknown {
  return signal?.reason ?? new DOMException('The operation was aborted', 'AbortError')
}
