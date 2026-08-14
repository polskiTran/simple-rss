import { Hono } from 'hono'
import { feedItemIdParameterSchema, type Library, type LibraryMembership } from '../../shared/api.js'
import type { LibraryService } from '../library/library-service.js'
import { readIdParam } from './id-param.js'
import { readListCursor } from './list-cursor.js'
import { NO_STORE, notFound, unavailable } from './responses.js'

export interface LibraryRouteDependencies {
  /** Absent only while startup could not open the database. */
  readonly library: () => LibraryService | undefined
}

/** Save and unsave are idempotent: both answer with the membership state that now holds. */
export function libraryRoutes(deps: LibraryRouteDependencies): Hono {
  const app = new Hono()

  app.get('/library', (c) => {
    const library = deps.library()
    if (!library) return unavailable(c)

    const cursor = readListCursor(c)
    if (!cursor.ok) return cursor.response
    return c.json<Library>(library.list(cursor.cursor), 200, NO_STORE)
  })

  app.put('/library/:feedItemId', (c) => {
    const library = deps.library()
    if (!library) return unavailable(c)
    const feedItemId = readIdParam(c, 'feedItemId', feedItemIdParameterSchema)
    if (!feedItemId.ok) return feedItemId.response

    const membership = library.save(feedItemId.value)
    if (!membership) return notFound(c)
    return c.json<LibraryMembership>(membership, 200, NO_STORE)
  })

  app.delete('/library/:feedItemId', (c) => {
    const library = deps.library()
    if (!library) return unavailable(c)
    const feedItemId = readIdParam(c, 'feedItemId', feedItemIdParameterSchema)
    if (!feedItemId.ok) return feedItemId.response

    return c.json<LibraryMembership>(library.unsave(feedItemId.value), 200, NO_STORE)
  })

  return app
}
