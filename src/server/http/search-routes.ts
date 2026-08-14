import { Hono } from 'hono'
import { searchQuerySchema, type SearchResults } from '../../shared/api.js'
import type { SearchService } from '../search/search-service.js'
import { NO_STORE } from './responses.js'

export interface SearchRouteDependencies {
  readonly search: SearchService
}

/**
 * The query travels as `?q=`, which request logging already omits, so what
 * the User searched for never lands in a log line.
 */
export function searchRoutes(deps: SearchRouteDependencies): Hono {
  const app = new Hono()

  app.get('/search', (c) => {
    const query = searchQuerySchema.safeParse(c.req.query('q'))
    if (!query.success) {
      return c.json({ error: { code: 'invalid_request', message: 'A search needs a query' } }, 400, NO_STORE)
    }

    return c.json<SearchResults>(deps.search.search(query.data), 200, NO_STORE)
  })

  return app
}
