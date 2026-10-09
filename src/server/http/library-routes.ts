import { Hono } from 'hono'
import { libraryRequestSchema, type Library, type LibraryMembership } from '../../shared/api.js'
import type { LibraryService } from '../library/library-service.js'
import { apiError, notFound, readId, readLibraryCursor } from './requests.js'

export interface LibraryRouteDependencies {
  readonly library: LibraryService
}

/** Save and unsave are idempotent: both answer with the membership state that now holds. */
export function libraryRoutes(deps: LibraryRouteDependencies): Hono {
  const app = new Hono()

  app.get('/library', (c) => {
    const request = libraryRequestSchema.safeParse(c.req.query())
    if (!request.success) {
      return apiError(c, 400, 'invalid_request', 'The Library orders by newest or oldest save')
    }
    const cursor = readLibraryCursor(c)
    if (!cursor.ok) return cursor.response
    return c.json<Library>(deps.library.list(request.data.order, cursor.value))
  })

  app.put('/library/:feedItemId', (c) => {
    const feedItemId = readId(c, 'feedItemId')
    if (!feedItemId.ok) return feedItemId.response

    const membership = deps.library.save(feedItemId.value)
    if (!membership) return notFound(c)
    return c.json<LibraryMembership>(membership)
  })

  app.delete('/library/:feedItemId', (c) => {
    const feedItemId = readId(c, 'feedItemId')
    if (!feedItemId.ok) return feedItemId.response

    return c.json<LibraryMembership>(deps.library.unsave(feedItemId.value))
  })

  return app
}
