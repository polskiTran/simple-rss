import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { extname, join, normalize, resolve, sep } from 'node:path'
import { Readable } from 'node:stream'
import type { MiddlewareHandler } from 'hono'

const CONTENT_TYPES: Record<string, string> = {
  '.avif': 'image/avif',
  '.css': 'text/css; charset=utf-8',
  '.gif': 'image/gif',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
}

/** Vite writes content-hashed file names here, so they can never go stale. */
const IMMUTABLE_PREFIX = '/assets/'

export interface StaticAssetsOptions {
  /** Absolute path to the built client bundle. */
  readonly root: string
}

/**
 * Serves the built client, falling back to `index.html` so client-side routes
 * survive a reload. `/api` and `/health` mount first, so a mistyped API path
 * can never return HTML.
 */
export function staticAssets(options: StaticAssetsOptions): MiddlewareHandler {
  const root = resolve(options.root)
  const indexPath = join(root, 'index.html')

  return async (c, next) => {
    if (c.req.method !== 'GET' && c.req.method !== 'HEAD') return next()

    const requested = resolveWithinRoot(root, c.req.path)
    if (requested && (await isFile(requested))) {
      return send(requested, cacheControlFor(c.req.path))
    }

    // A missing bundle file is a broken build, not a client route: falling
    // back would answer a stale `<script src>` with HTML at 200.
    if (c.req.path.startsWith(IMMUTABLE_PREFIX)) return next()

    if (await isFile(indexPath)) {
      return send(indexPath, 'no-cache')
    }

    return next()
  }
}

/**
 * Traversal is checked on the resolved path, so encoded and mixed forms
 * (`..%2f`, `/a/../../etc`) are all covered by the same test.
 */
function resolveWithinRoot(root: string, urlPath: string): string | undefined {
  let decoded: string
  try {
    decoded = decodeURIComponent(urlPath)
  } catch {
    return undefined
  }
  if (decoded.includes('\0')) return undefined

  const candidate = resolve(join(root, normalize(decoded)))
  return candidate === root || candidate.startsWith(root + sep) ? candidate : undefined
}

function cacheControlFor(urlPath: string): string {
  return urlPath.startsWith(IMMUTABLE_PREFIX) ? 'public, max-age=31536000, immutable' : 'no-cache'
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile()
  } catch {
    return false
  }
}

function send(path: string, cacheControl: string): Response {
  const body = Readable.toWeb(createReadStream(path)) as ReadableStream
  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': CONTENT_TYPES[extname(path).toLowerCase()] ?? 'application/octet-stream',
      'Cache-Control': cacheControl,
    },
  })
}
