import { Hono } from 'hono'
import { searchRequestSchema, type SearchResults } from '../../shared/api.js'
import type { SearchService } from '../search/search-service.js'
import { apiError, notFound } from './requests.js'

export interface SearchRouteDependencies {
  readonly search: SearchService
}

export function searchRoutes(deps: SearchRouteDependencies): Hono {
  const app = new Hono()

  app.get('/search', (c) => {
    const request = searchRequestSchema.safeParse(c.req.query())
    if (!request.success) {
      return apiError(c, 400, 'invalid_request', 'A search takes a query, at most one scope, and a known sort')
    }

    const answer = deps.search.search(request.data.query, request.data.scope, request.data.sort)
    return answer === undefined ? notFound(c) : c.json<SearchResults>(answer)
  })

  return app
}
