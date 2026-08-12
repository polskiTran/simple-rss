import type { MiddlewareHandler } from 'hono'

/**
 * The client is a same-origin bundle with no inline scripts, so the policy can
 * stay this narrow. `img-src 'self'` is what the image proxy makes possible;
 * `data:` covers the small inline SVGs the client draws itself.
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

/**
 * Safe to send unconditionally: browsers ignore it on plain HTTP. No `preload`
 * — submitting a User's domain to a browser-vendor list is not this service's call.
 */
const STRICT_TRANSPORT_SECURITY = 'max-age=31536000; includeSubDomains'

export function securityHeaders(): MiddlewareHandler {
  return async (c, next) => {
    await next()
    c.header('Content-Security-Policy', CONTENT_SECURITY_POLICY)
    c.header('Strict-Transport-Security', STRICT_TRANSPORT_SECURITY)
    c.header('X-Content-Type-Options', 'nosniff')
    c.header('Referrer-Policy', 'no-referrer')
    c.header('Cross-Origin-Opener-Policy', 'same-origin')
    c.header('Cross-Origin-Resource-Policy', 'same-origin')
    c.header('X-Frame-Options', 'DENY')
  }
}
