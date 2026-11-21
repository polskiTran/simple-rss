import type { MiddlewareHandler } from 'hono'
import { apiError } from './requests.js'

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

export interface SameOriginOptions {
  readonly trustProxyHeaders: boolean
}

export function sameOrigin(options: SameOriginOptions): MiddlewareHandler {
  return async (c, next) => {
    if (SAFE_METHODS.has(c.req.method)) return next()

    const origin = parse(c.req.header('origin'))
    const host = c.req.header('host')

    if (!origin || !host || origin.host !== host || origin.protocol !== expectedProtocol(c, options)) {
      return apiError(c, 403, 'forbidden_origin', 'Request must come from this application')
    }

    return next()
  }
}

function expectedProtocol(c: Parameters<MiddlewareHandler>[0], options: SameOriginOptions): string {
  const forwarded = options.trustProxyHeaders ? c.req.header('x-forwarded-proto')?.split(',')[0]?.trim() : undefined

  return forwarded ? `${forwarded.toLowerCase()}:` : new URL(c.req.url).protocol
}

function parse(origin: string | undefined): URL | undefined {
  if (!origin) return undefined
  try {
    return new URL(origin)
  } catch {
    return undefined
  }
}
