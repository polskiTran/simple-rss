export interface HttpTimings {
  readonly connectionReused: boolean
  readonly connectMs?: number
  readonly tlsMs?: number
  readonly ttfbMs?: number
}

export interface HttpConnection {
  /**
   * The addresses `validateDestination` approved for this hop's host. The
   * adapter connects only to these and never resolves the name itself.
   */
  readonly addresses: readonly string[]
  /** Reported once, when the headers arrive, by an adapter that can time its connection. */
  readonly onTimings?: (timings: HttpTimings) => void
}

/**
 * Internal transport seam; feature modules depend on `Retrieval`, never this.
 * Requests are body-less GETs. An adapter must connect only to
 * `connection.addresses`, follow no redirects, honour the signal, and fully
 * decode declared encodings.
 */
export type HttpClient = (request: Request, connection: HttpConnection) => Promise<Response>

export type HttpClientFailureCode = 'blocked_destination' | 'unsupported_content_encoding'

export class HttpClientError extends Error {
  readonly code: HttpClientFailureCode

  constructor(code: HttpClientFailureCode, message: string) {
    super(message)
    this.name = 'HttpClientError'
    this.code = code
  }
}
