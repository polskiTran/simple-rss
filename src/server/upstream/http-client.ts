/**
 * Internal transport seam; feature modules depend on `Retrieval`, never this.
 * An adapter must validate resolved socket addresses, follow no redirects,
 * honour the signal, and fully decode declared encodings.
 */
export type HttpClient = (request: Request) => Promise<Response>

export type HttpClientFailureCode = 'blocked_destination' | 'unresolvable_host' | 'unsupported_content_encoding'

export class HttpClientError extends Error {
  readonly code: HttpClientFailureCode

  constructor(code: HttpClientFailureCode, message: string) {
    super(message)
    this.name = 'HttpClientError'
    this.code = code
  }
}
