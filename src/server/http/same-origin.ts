import type { MiddlewareHandler } from 'hono'
import { NO_STORE } from './responses.js'

/** Methods that cannot change anything, so a foreign page reading them is moot. */
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

export interface SameOriginOptions {
  /** Whether `X-Forwarded-Proto` may be believed. See `client-address.ts`. */
  readonly trustProxyHeaders: boolean
}

/**
 * Refuses a state-changing request that did not come from this application.
 *
 * The session cookie is `SameSite=Strict`, which already stops a foreign page
 * from carrying it. This is the second lock: it does not depend on the
 * browser's cookie policy, and it also covers the case that policy has always
 * been weakest at — a same-site but different-origin page.
 *
 * A missing `Origin` is refused rather than waved through. Every caller of
 * this API is a browser making a same-origin `fetch`, and browsers always send
 * `Origin` on these methods; the exception exists only for tools that are not
 * the client.
 */
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
 * The scheme this request really arrived over.
 *
 * The socket is plain HTTP behind a TLS-terminating proxy, so the request URL
 * would say `http:` while the browser correctly reports `https:` — comparing
 * them directly would reject every real request. `X-Forwarded-Proto` is what
 * bridges that, and it is only believed on the same terms as the address
 * header it travels with.
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

/**
 * The origin as a URL, or `undefined` when it is not one at all — `Origin:
 * null`, which a sandboxed frame sends, must never match.
 */
function parse(origin: string | undefined): URL | undefined {
  if (!origin) return undefined
  try {
    return new URL(origin)
  } catch {
    return undefined
  }
}
