import type { SearchScope } from '../shared/api.js'

export const SEARCH_SCOPE_COPY = {
  everywhere: { prompt: 'search your reading', place: undefined },
  saved: { prompt: 'search your saves', place: 'your saves' },
  subscriptions: { prompt: 'search your feeds', place: 'your feeds' },
  feed: { prompt: 'search this feed', place: 'this feed' },
} as const satisfies Record<SearchScope['kind'], { prompt: string; place: string | undefined }>
