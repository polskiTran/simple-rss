import { useEffect, useState } from 'react'
import type { SearchResult, SearchSubscriptionMatch } from '../../shared/api.js'
import { fetchSearchResults } from '../api.js'
import { FeedTitleLink } from '../components/feed-title-link.js'
import { HomePageLink } from '../components/home-page-link.js'
import { ItemTitleLink } from '../components/item-title-link.js'
import { LoadingNote } from '../components/loading-note.js'
import { SaveToggle } from '../components/save-toggle.js'
import { routedClick } from '../routed-link.js'
import { feedPathOf } from '../routing.js'
// PROTOTYPE: variant switch for the jump-to group; remove with the prototype.
import { PrototypeJumpTo, PrototypeSwitcher } from './search-jump-to-prototype.js'
import { failureKind } from './failure.js'

export interface SearchResultsViewProps {
  query: string
  onOpenItem(feedItemId: number): void
  onOpenFeed(feedId: number): void
}

type SearchState =
  | { readonly kind: 'searching' }
  | {
      readonly kind: 'found'
      readonly subscriptions: readonly SearchSubscriptionMatch[]
      readonly results: readonly SearchResult[]
    }
  | { readonly kind: 'unavailable' }
  | { readonly kind: 'unreachable' }

const SEARCH_SETTLE_MS = 250

export function SearchResultsView({ query, onOpenItem, onOpenFeed }: SearchResultsViewProps) {
  const [state, setState] = useState<SearchState>({ kind: 'searching' })
  const line = query.trim()

  useEffect(() => {
    const request = new AbortController()
    setState({ kind: 'searching' })
    const settle = window.setTimeout(() => {
      void fetchSearchResults(line, request.signal)
        .then((found) => {
          if (!request.signal.aborted)
            setState({ kind: 'found', subscriptions: found.subscriptions, results: found.results })
        })
        .catch((cause: unknown) => {
          if (!request.signal.aborted) setState({ kind: failureKind(cause) })
        })
    }, SEARCH_SETTLE_MS)
    return () => {
      request.abort()
      window.clearTimeout(settle)
    }
  }, [line])

  const setSaved = (feedItemId: number, saved: boolean) => {
    setState((current) =>
      current.kind === 'found'
        ? {
            ...current,
            results: current.results.map((result) =>
              result.feedItemId === feedItemId ? { ...result, saved } : result,
            ),
          }
        : current,
    )
  }

  return (
    <div className="view measure search-results-view">
      <SearchOutcome state={state} line={line} onOpenItem={onOpenItem} onOpenFeed={onOpenFeed} onSaved={setSaved} />
      <PrototypeSwitcher />
    </div>
  )
}

function SearchOutcome({
  state,
  line,
  onOpenItem,
  onOpenFeed,
  onSaved,
}: {
  state: SearchState
  line: string
  onOpenItem: (feedItemId: number) => void
  onOpenFeed: (feedId: number) => void
  onSaved: (feedItemId: number, saved: boolean) => void
}) {
  if (state.kind === 'searching') {
    return (
      <LoadingNote className="empty-note" announce>
        searching…
      </LoadingNote>
    )
  }
  if (state.kind === 'unavailable' || state.kind === 'unreachable') {
    return (
      <p className="empty-note" role="status">
        {state.kind === 'unreachable'
          ? 'search is out of reach — check the connection, then try again'
          : 'search is unavailable — try again in a moment'}
      </p>
    )
  }
  if (state.subscriptions.length === 0 && state.results.length === 0) {
    return (
      <p className="empty-note" role="status">
        nothing in your reading matches “{line}”
      </p>
    )
  }

  return (
    <div className="search-answer" role="region" aria-label="search results">
      {/* PROTOTYPE: was <JumpToGroup subscriptions={state.subscriptions} onOpenFeed={onOpenFeed} /> */}
      <PrototypeJumpTo subscriptions={state.subscriptions} onOpenFeed={onOpenFeed} />
      {state.results.length > 0 && (
        <div className="content-list">
          {state.results.map((result) => (
            <article className="content-item" key={result.feedItemId}>
              <h3 className="content-item-title">
                <ItemTitleLink feedItemId={result.feedItemId} title={result.title} onOpen={onOpenItem} />
              </h3>
              {result.snippet !== null && <p className="content-snippet">{result.snippet}</p>}
              <div className="content-meta">
                <FeedTitleLink feedId={result.feedId} title={result.feedTitle} onOpen={onOpenFeed} />
                <time dateTime={result.publishedAt ?? result.firstSeenAt}>{result.displayDate}</time>
                <SaveToggle
                  feedItemId={result.feedItemId}
                  title={result.title}
                  saved={result.saved}
                  onSaved={(saved) => onSaved(result.feedItemId, saved)}
                />
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  )
}

/**
 * Matching Subscriptions as a jump into their Feeds, atop the item results in
 * the standard item shape: the title is the way in, the meta is the feeds-list
 * domain. Whitespace alone separates the group from the items below.
 */
function JumpToGroup({
  subscriptions,
  onOpenFeed,
}: {
  subscriptions: readonly SearchSubscriptionMatch[]
  onOpenFeed: (feedId: number) => void
}) {
  if (subscriptions.length === 0) return null

  return (
    <nav className="content-list" aria-label="matching subscriptions">
      {subscriptions.map((subscription) => (
        <article className="content-item" key={subscription.feedId}>
          <h3 className="content-item-title">
            <a
              className="feed-open"
              href={feedPathOf(subscription.feedId)}
              onClick={routedClick(() => onOpenFeed(subscription.feedId))}
            >
              {subscription.title}
            </a>
          </h3>
          <div className="content-meta">
            <HomePageLink domain={subscription.domain} homePageUrl={subscription.homePageUrl} />
          </div>
        </article>
      ))}
    </nav>
  )
}
