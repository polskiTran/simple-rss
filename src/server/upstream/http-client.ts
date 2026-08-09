/**
 * Internal transport seam for the retrieval module.
 *
 * Feature modules depend on `Retrieval`, never this adapter. A production
 * adapter validates the socket's resolved addresses, follows no redirects,
 * honours the Request signal, fully decodes declared encodings, and tears down
 * abandoned connections. Tests inside `src/server/upstream` may replace it.
 */
export type HttpClient = (request: Request) => Promise<Response>

export type HttpClientFailureCode =
  | 'blocked_destination'
  | 'unresolvable_host'
  | 'unsupported_content_encoding'

/** A safe, typed transport failure the retrieval module can return unchanged. */
export class HttpClientError extends Error {
  readonly code: HttpClientFailureCode

  constructor(code: HttpClientFailureCode, message: string) {
    super(message)
    this.name = 'HttpClientError'
    this.code = code
  }
}
