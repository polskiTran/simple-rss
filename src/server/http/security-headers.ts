import type { MiddlewareHandler } from 'hono'

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

/** Safe to send unconditionally: browsers ignore it on plain HTTP. */
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
