import { Hono, type Context } from 'hono'
import { feedItemIdParameterSchema, IMAGE_CACHE_SECONDS } from '../../shared/api.js'
import type { Clock } from '../clock.js'
import type { ImageOutcome, ImageService } from '../images/image-service.js'
import { ImageRateLimiter } from '../images/image-rate-limit.js'
import type { ImageUrlSignature } from '../images/image-url-signature.js'
import { clientAddress } from './client-address.js'
import { NO_STORE, unavailable } from './responses.js'

export interface ImageRouteDependencies {
  /** Absent only while startup could not open the database. */
  readonly images: () => ImageService | undefined
  readonly signature: () => ImageUrlSignature | undefined
  readonly clock: Clock
  readonly trustProxyHeaders: boolean
}

/**
 * The image proxy accepts a Feed Item identity or a URL extraction itself
 * signed, never an arbitrary target. Refusals that name a wait keep their
 * status (429, 503); every other failure is the same 404.
 */
export function imageRoutes(deps: ImageRouteDependencies): Hono {
  const app = new Hono()
  const limiter = new ImageRateLimiter(deps.clock)

  const limited = (c: Context): Response | undefined => {
    const verdict = limiter.allow(clientAddress(c, deps.trustProxyHeaders))
    if (verdict.allowed) return undefined
    return c.json(
      { error: { code: 'image_rate_limited', message: 'Too many image requests; wait before retrying' } },
      429,
      { ...NO_STORE, 'Retry-After': String(verdict.retryAfterSeconds) },
    )
  }

  app.get('/items/:feedItemId/image', async (c) => {
    const images = deps.images()
    if (!images) return unavailable(c)

    const refused = limited(c)
    if (refused) return refused

    const feedItemId = feedItemIdParameterSchema.safeParse(c.req.param('feedItemId'))
    if (!feedItemId.success) return imageUnavailable(c)

    return answer(c, await images.itemImage(feedItemId.data, c.req.raw.signal))
  })

  app.get('/reader/image', async (c) => {
    const images = deps.images()
    const signature = deps.signature()
    if (!images || !signature) return unavailable(c)

    const refused = limited(c)
    if (refused) return refused

    const verified = signature.verify(new URL(c.req.url).searchParams)
    if (!verified.ok) return imageUnavailable(c)

    return answer(c, await images.readerImage(verified.url, c.req.raw.signal))
  })

  return app
}

function answer(c: Context, outcome: ImageOutcome): Response {
  switch (outcome.kind) {
    case 'image':
      return c.body(outcome.body, 200, {
        'Content-Type': outcome.contentType,
        'Cache-Control': `private, max-age=${IMAGE_CACHE_SECONDS}`,
        'X-Content-Type-Options': 'nosniff',
      })
    case 'retrieval-failed':
      return outcome.failure.code === 'busy'
        ? c.json({ error: { code: 'image_busy', message: 'The image proxy is at capacity' } }, 503, NO_STORE)
        : imageUnavailable(c)
    case 'missing':
    case 'not-image':
      return imageUnavailable(c)
  }
}

function imageUnavailable(c: Context): Response {
  return c.json({ error: { code: 'image_unavailable', message: 'No image is available' } }, 404, NO_STORE)
}
