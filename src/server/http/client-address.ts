import { getConnInfo } from '@hono/node-server/conninfo'
import type { Context } from 'hono'

/** What rate limiting counts against when the caller cannot be identified. */
const UNKNOWN = 'unknown'

/**
 * Behind the platform proxy every socket shares one address, so the rightmost
 * `X-Forwarded-For` entry — the one the nearest proxy appended — wins;
 * anything further left is caller-supplied. Untrusted deployments ignore the header.
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
