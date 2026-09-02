import type { SearchScope } from '../shared/api.js'

/**
 * The words for each scope: what the line says it would answer from before
 * the first keystroke, and how a bounded surface names its bound in prose.
 * A Feed-bounded surface names the Feed itself; `place` is its fallback.
 */
export const SEARCH_SCOPE_COPY = {
  everywhere: { prompt: 'search your reading', place: undefined },
  saved: { prompt: 'search your saves', place: 'your saves' },
  subscriptions: { prompt: 'search your feeds', place: 'your feeds' },
  feed: { prompt: 'search this feed', place: 'this feed' },
} as const satisfies Record<SearchScope['kind'], { prompt: string; place: string | undefined }>
