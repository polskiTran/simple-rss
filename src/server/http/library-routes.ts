import { Hono, type Context } from 'hono'
import {
  feedItemIdParameterSchema,
  type Library,
  type LibraryMembership,
} from '../../shared/api.js'
import type { LibraryService } from '../library/library-service.js'
import { readListCursor } from './list-cursor.js'
import { NO_STORE, unavailable } from './responses.js'

export interface LibraryRouteDependencies {
  /** Absent only while startup could not open the database. */
  readonly library: () => LibraryService | undefined
}

/**
 * Save and unsave are idempotent: both answer with the membership state that
 * now holds, so repeating either is confirmation rather than conflict.
 */
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
    const feedItemId = feedItemIdParameterSchema.safeParse(c.req.param('feedItemId'))
    if (!feedItemId.success) return notFound(c)

    const membership = library.save(feedItemId.data)
    if (!membership) return notFound(c)
    return c.json<LibraryMembership>(membership, 200, NO_STORE)
  })

  app.delete('/library/:feedItemId', (c) => {
    const library = deps.library()
    if (!library) return unavailable(c)
    const feedItemId = feedItemIdParameterSchema.safeParse(c.req.param('feedItemId'))
    if (!feedItemId.success) return notFound(c)

    return c.json<LibraryMembership>(library.unsave(feedItemId.data), 200, NO_STORE)
  })

  return app
}

function notFound(c: Context) {
  return c.json({ error: { code: 'not_found', message: 'Not found' } }, 404, NO_STORE)
}
