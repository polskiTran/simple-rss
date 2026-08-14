import { Hono } from 'hono'
import { feedItemIdParameterSchema, type Library, type LibraryMembership } from '../../shared/api.js'
import type { LibraryService } from '../library/library-service.js'
import { readIdParam } from './id-param.js'
import { readListCursor } from './list-cursor.js'
import { NO_STORE, notFound } from './responses.js'

export interface LibraryRouteDependencies {
  readonly library: LibraryService
}

/** Save and unsave are idempotent: both answer with the membership state that now holds. */
export function libraryRoutes(deps: LibraryRouteDependencies): Hono {
  const app = new Hono()

  app.get('/library', (c) => {
    const cursor = readListCursor(c)
    if (!cursor.ok) return cursor.response
    return c.json<Library>(deps.library.list(cursor.cursor), 200, NO_STORE)
  })

  app.put('/library/:feedItemId', (c) => {
    const feedItemId = readIdParam(c, 'feedItemId', feedItemIdParameterSchema)
    if (!feedItemId.ok) return feedItemId.response

    const membership = deps.library.save(feedItemId.value)
    if (!membership) return notFound(c)
    return c.json<LibraryMembership>(membership, 200, NO_STORE)
  })

  app.delete('/library/:feedItemId', (c) => {
    const feedItemId = readIdParam(c, 'feedItemId', feedItemIdParameterSchema)
    if (!feedItemId.ok) return feedItemId.response

    return c.json<LibraryMembership>(deps.library.unsave(feedItemId.value), 200, NO_STORE)
  })

  return app
}
