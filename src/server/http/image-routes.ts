import { Hono, type Context } from 'hono'
import { IMAGE_CACHE_SECONDS, idParameterSchema } from '../../shared/api.js'
import type { Clock } from '../clock.js'
import type { ImageOutcome, ImageService } from '../images/image-service.js'
import { ImageRateLimiter } from '../images/image-rate-limit.js'
import type { ImageUrlSignature } from '../images/image-url-signature.js'
import { clientAddress } from './client-address.js'
import { apiError } from './requests.js'

export interface ImageRouteDependencies {
  readonly images: ImageService
  readonly signature: ImageUrlSignature
  readonly clock: Clock
  readonly trustProxyHeaders: boolean
}

/**
 * The image proxy accepts a Feed Item identity or a signed Reader image URL,
 * never an arbitrary target. Refusals that name a wait keep their
 * status (429, 503); every other failure is the same 404.
 */
export function imageRoutes(deps: ImageRouteDependencies): Hono {
  const app = new Hono()
  const limiter = new ImageRateLimiter(deps.clock)

  const limited = (c: Context): Response | undefined => {
    const verdict = limiter.allow(clientAddress(c, deps.trustProxyHeaders))
    if (verdict.allowed) return undefined
    return apiError(c, 429, 'image_rate_limited', 'Too many image requests; wait before retrying', {
      'Retry-After': String(verdict.retryAfterSeconds),
    })
  }

  app.get('/items/:feedItemId/image', async (c) => {
    const refused = limited(c)
    if (refused) return refused

    const feedItemId = idParameterSchema.safeParse(c.req.param('feedItemId'))
    if (!feedItemId.success) return imageUnavailable(c)

    return answer(c, await deps.images.itemImage(feedItemId.data, c.req.raw.signal))
  })

  app.get('/reader/image', async (c) => {
    const refused = limited(c)
    if (refused) return refused

    const verified = deps.signature.verify(new URL(c.req.url).searchParams)
    if (!verified.ok) return imageUnavailable(c)

    return answer(c, await deps.images.image(verified.url, c.req.raw.signal))
  })

  return app
}

function answer(c: Context, outcome: ImageOutcome): Response {
  switch (outcome.kind) {
    case 'image':
      return c.body(outcome.body, 200, {
        'Content-Type': outcome.contentType,
        'Cache-Control': `private, max-age=${IMAGE_CACHE_SECONDS}`,
      })
    case 'retrieval-failed':
      return outcome.failure.code === 'busy'
        ? apiError(c, 503, 'image_busy', 'The image proxy is at capacity')
        : imageUnavailable(c)
    case 'missing':
    case 'not-image':
      return imageUnavailable(c)
  }
}

function imageUnavailable(c: Context): Response {
  return apiError(c, 404, 'image_unavailable', 'No image is available')
}
