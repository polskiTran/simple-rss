export interface HttpTimings {
  readonly connectionReused: boolean
  readonly socketDnsMs?: number
  readonly connectMs?: number
  readonly tlsMs?: number
  readonly ttfbMs?: number
}

/**
 * Internal transport seam; feature modules depend on `Retrieval`, never this.
 * An adapter must validate resolved socket addresses, follow no redirects,
 * honour the signal, and fully decode declared encodings. An adapter that can
 * time its connection reports `onTimings` once, when the headers arrive.
 */
export type HttpClient = (request: Request, onTimings?: (timings: HttpTimings) => void) => Promise<Response>

export type HttpClientFailureCode = 'blocked_destination' | 'unresolvable_host' | 'unsupported_content_encoding'

export class HttpClientError extends Error {
  readonly code: HttpClientFailureCode

  constructor(code: HttpClientFailureCode, message: string) {
    super(message)
    this.name = 'HttpClientError'
    this.code = code
  }
}
