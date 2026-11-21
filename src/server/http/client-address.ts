import { getConnInfo } from '@hono/node-server/conninfo'
import type { Context } from 'hono'

const UNKNOWN = 'unknown'

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
