import type { MiddlewareHandler } from 'hono'
import { NO_STORE } from './responses.js'

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

export interface SameOriginOptions {
  /** Whether `X-Forwarded-Proto` may be believed. See `client-address.ts`. */
  readonly trustProxyHeaders: boolean
}

/** A missing `Origin` is refused — browsers always send it on these methods. */
export function sameOrigin(options: SameOriginOptions): MiddlewareHandler {
  return async (c, next) => {
    if (SAFE_METHODS.has(c.req.method)) return next()

    const origin = parse(c.req.header('origin'))
    const host = c.req.header('host')

    if (!origin || !host || origin.host !== host || origin.protocol !== expectedProtocol(c, options)) {
      return c.json(
        { error: { code: 'forbidden_origin', message: 'Request must come from this application' } },
        403,
        NO_STORE,
      )
    }

    return next()
  }
}

/**
 * Behind the TLS-terminating proxy the request URL says `http:` while the
 * browser reports `https:`; `X-Forwarded-Proto` bridges that, believed on the
 * same terms as the address header it travels with.
 */
function expectedProtocol(
  c: Parameters<MiddlewareHandler>[0],
  options: SameOriginOptions,
): string {
  const forwarded = options.trustProxyHeaders
    ? c.req.header('x-forwarded-proto')?.split(',')[0]?.trim()
    : undefined

  return forwarded ? `${forwarded.toLowerCase()}:` : new URL(c.req.url).protocol
}

/** `Origin: null` — what a sandboxed frame sends — must never match. */
function parse(origin: string | undefined): URL | undefined {
  if (!origin) return undefined
  try {
    return new URL(origin)
  } catch {
    return undefined
  }
}
