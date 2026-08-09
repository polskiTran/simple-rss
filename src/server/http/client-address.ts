import { getConnInfo } from '@hono/node-server/conninfo'
import type { Context } from 'hono'

/** What rate limiting counts against when the caller cannot be identified. */
const UNKNOWN = 'unknown'

/**
 * Which client a request should be rate-limited against.
 *
 * Behind the documented deployment every socket comes from the platform's
 * proxy, so the socket address alone would make one bucket for the whole
 * internet. `X-Forwarded-For` fixes that, but only the entry the *nearest*
 * proxy appended is trustworthy — anything further left was supplied by the
 * caller and can be invented. So the rightmost entry wins, and a forged header
 * can only ever put an attacker in their own bucket.
 *
 * With `trustProxyHeaders` off the header is ignored entirely, which is the
 * correct reading when the service is exposed directly.
 */
export function clientAddress(c: Context, trustProxyHeaders: boolean): string {
  if (trustProxyHeaders) {
    const forwarded = c.req
      .header('x-forwarded-for')
      ?.split(',')
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0)

    const nearest = forwarded?.[forwarded.length - 1]
    if (nearest) return nearest
  }

  return getConnInfo(c).remote.address ?? UNKNOWN
}
