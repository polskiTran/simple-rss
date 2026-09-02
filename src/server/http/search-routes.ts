import { Hono } from 'hono'
import { searchRequestSchema, type SearchResults } from '../../shared/api.js'
import type { SearchService } from '../search/search-service.js'
import { NO_STORE, notFound } from './responses.js'

export interface SearchRouteDependencies {
  readonly search: SearchService
}

export function searchRoutes(deps: SearchRouteDependencies): Hono {
  const app = new Hono()

  app.get('/search', (c) => {
    const request = searchRequestSchema.safeParse(c.req.query())
    if (!request.success) {
      return c.json(
        { error: { code: 'invalid_request', message: 'A search takes a query and at most one bound' } },
        400,
        NO_STORE,
      )
    }

    const answer = deps.search.search(request.data.query, request.data.scope)
    return answer === undefined ? notFound(c) : c.json<SearchResults>(answer, 200, NO_STORE)
  })

  return app
}
