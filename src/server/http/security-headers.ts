import type { MiddlewareHandler } from 'hono'

/**
 * The client is a same-origin bundle with no inline scripts, no external
 * origins, and no embedded media, so the policy can stay this narrow.
 *
 * `img-src 'self'` is what the image proxy exists to make possible: Feed and
 * Reader images are fetched by the server, never by the Owner's browser.
 * `data:` stays allowed for the small inline SVGs the client draws itself.
 */
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "form-action 'self'",
].join('; ')

export function securityHeaders(): MiddlewareHandler {
  return async (c, next) => {
    await next()
    c.header('Content-Security-Policy', CONTENT_SECURITY_POLICY)
    c.header('X-Content-Type-Options', 'nosniff')
    c.header('Referrer-Policy', 'no-referrer')
    c.header('Cross-Origin-Opener-Policy', 'same-origin')
    c.header('Cross-Origin-Resource-Policy', 'same-origin')
    c.header('X-Frame-Options', 'DENY')
  }
}
