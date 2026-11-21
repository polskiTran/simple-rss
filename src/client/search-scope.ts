import type { SearchScope } from '../shared/api.js'

export const SEARCH_SCOPE_COPY = {
  everywhere: { prompt: 'Search your reading', place: 'your reading', label: 'Everywhere' },
  saved: { prompt: 'Search your saves', place: 'your saves', label: 'Saved' },
  subscriptions: { prompt: 'Search your feeds', place: 'your feeds', label: 'Feeds' },
  feed: { prompt: 'Search this feed', place: 'this feed', label: 'This feed' },
} as const satisfies Record<SearchScope['kind'], { prompt: string; place: string; label: string }>
