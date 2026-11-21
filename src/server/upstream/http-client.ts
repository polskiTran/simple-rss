export interface HttpTimings {
  readonly connectionReused: boolean
  readonly connectMs?: number
  readonly tlsMs?: number
  readonly ttfbMs?: number
}

export interface HttpConnection {
  readonly addresses: readonly string[]
  readonly onTimings?: (timings: HttpTimings) => void
}

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
