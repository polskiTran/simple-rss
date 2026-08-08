import type { HttpClient } from '../../src/server/upstream/http-client.js'

export interface FixtureResponse {
  readonly status?: number
  readonly headers?: Record<string, string>
  readonly body?: string | Uint8Array
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

      const { status = 200, headers = {}, body = '' } = typeof stubbed === 'function' ? stubbed() : stubbed
      return new Response(body as BodyInit, { status, headers })
    }
  }
}
