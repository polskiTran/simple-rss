/**
 * An adapter must validate every address it connects to — including any it was
 * handed — follow no redirects, honour the signal, and fully decode declared
 * encodings.
 */
export type HttpClient = (request: Request, addresses?: readonly [string, ...string[]]) => Promise<Response>

export type HttpClientFailureCode = 'blocked_destination' | 'unresolvable_host' | 'unsupported_content_encoding'

export class HttpClientError extends Error {
  readonly code: HttpClientFailureCode

  constructor(code: HttpClientFailureCode, message: string) {
    super(message)
    this.name = 'HttpClientError'
    this.code = code
  }
}
