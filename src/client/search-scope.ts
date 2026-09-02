import type { SearchScope } from '../shared/api.js'

/** The words of each scope: the line's placeholder, and the place the empty state and scope line name. */
export const SEARCH_SCOPE_COPY = {
  everywhere: { prompt: 'search your reading', place: 'your reading' },
  saved: { prompt: 'search your saves', place: 'your saves' },
  subscriptions: { prompt: 'search your feeds', place: 'your feeds' },
  feed: { prompt: 'search this feed', place: 'this feed' },
} as const satisfies Record<SearchScope['kind'], { prompt: string; place: string }>
