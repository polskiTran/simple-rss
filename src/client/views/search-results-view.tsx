import { searchParamsOf, type SearchScope, type SearchSubscriptionMatch } from '../../shared/api.js'
import { ApiError, fetchSearchResults } from '../api.js'
import { CadenceStrip } from '../components/cadence-strip.js'
import { FeedTitleLink } from '../components/feed-title-link.js'
import { HomePageLink } from '../components/home-page-link.js'
import { ItemTitleLink } from '../components/item-title-link.js'
import { LoadingNote } from '../components/loading-note.js'
import { SaveToggle } from '../components/save-toggle.js'
import { routedClick } from '../routed-link.js'
import { feedPathOf, searchPathOf } from '../routing.js'
import { SEARCH_SCOPE_COPY } from '../search-scope.js'
import { useResource, valueInView } from '../use-resource.js'

export interface SearchResultsViewProps {
  settledQuery: string
  scope: SearchScope
  onEverywhere(): void
  onOpenItem(feedItemId: number): void
  onOpenFeed(feedId: number): void
}

export function SearchResultsView({
  settledQuery,
  scope,
  onEverywhere,
  onOpenItem,
  onOpenFeed,
}: SearchResultsViewProps) {
  const line = settledQuery.trim()
  const request = searchParamsOf(line, scope).toString()
  const [found, { set }] = useResource((signal) => fetchSearchResults(line, scope, signal), [request])
  const answer = valueInView(found)

  const setSaved = (feedItemId: number, saved: boolean) =>
    set((current) =>
      'results' in current
        ? {
            ...current,
            results: current.results.map((result) =>
              result.feedItemId === feedItemId ? { ...result, saved } : result,
            ),
          }
        : current,
    )

  const everywhere = (
    <a
      className="search-everywhere"
      href={searchPathOf(line, { kind: 'everywhere' })}
      onClick={routedClick(onEverywhere)}
    >
      everywhere
    </a>
  )

  if (found.kind === 'unreachable' || found.kind === 'unavailable') {
    return (
      <div className="view measure search-results-view">
        <p className="empty-note" role="status">
          {found.kind === 'unreachable' ? (
            'search is out of reach — check the connection, then try again'
          ) : found.error instanceof ApiError && found.error.status === 404 ? (
            <>that feed is gone — try {everywhere}</>
          ) : (
            'search is unavailable — try again in a moment'
          )}
        </p>
      </div>
    )
  }

  if (answer === undefined) {
    return (
      <div className="view measure search-results-view">
        <LoadingNote className="empty-note" announce>
          searching…
        </LoadingNote>
      </div>
    )
  }

  const place = answer.scope === 'feed' ? answer.feed.title : SEARCH_SCOPE_COPY[answer.scope].place
  const scopeLine = answer.scope !== 'everywhere' && (
    <p className="search-scope">
      in {place} · {everywhere}
    </p>
  )
  const subscriptions = 'subscriptions' in answer ? answer.subscriptions : []
  const results = 'results' in answer ? answer.results : []

  return (
    <div className="view measure search-results-view">
      {scopeLine}
      {subscriptions.length === 0 && results.length === 0 ? (
        <p className="empty-note" role="status">
          nothing in {place} matches “{line}”
        </p>
      ) : (
        <div className="search-answer" role="region" aria-label="search results" aria-busy={found.kind === 'loading'}>
          <JumpToGroup subscriptions={subscriptions} onOpenFeed={onOpenFeed} />
          {results.length > 0 && (
            <div className="content-list">
              {results.map((result) => (
                <article className="content-item" key={result.feedItemId}>
                  <h3 className="content-item-title">
                    <ItemTitleLink feedItemId={result.feedItemId} title={result.title} onOpen={onOpenItem} />
                  </h3>
                  {result.snippet !== null && <p className="content-snippet">{result.snippet}</p>}
                  <div className="content-meta">
                    {answer.scope !== 'feed' && (
                      <FeedTitleLink feedId={result.feedId} title={result.feedTitle} onOpen={onOpenFeed} />
                    )}
                    <time dateTime={result.publishedAt ?? result.firstSeenAt}>{result.displayDate}</time>
                    <SaveToggle
                      feedItemId={result.feedItemId}
                      title={result.title}
                      saved={result.saved}
                      onSaved={(saved) => setSaved(result.feedItemId, saved)}
                    />
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function JumpToGroup({
  subscriptions,
  onOpenFeed,
}: {
  subscriptions: readonly SearchSubscriptionMatch[]
  onOpenFeed: (feedId: number) => void
}) {
  if (subscriptions.length === 0) return null

  return (
    <nav className="search-jump-to" aria-label="matching subscriptions">
      {subscriptions.map((subscription) => (
        <div className="search-jump-row" key={subscription.feedId}>
          <a
            className="feed-open search-jump-name"
            href={feedPathOf(subscription.feedId)}
            onClick={routedClick(() => onOpenFeed(subscription.feedId))}
          >
            {subscription.title}
          </a>
          <HomePageLink
            className="search-jump-domain"
            domain={subscription.domain}
            homePageUrl={subscription.homePageUrl}
          />
          <CadenceStrip counts={subscription.cadence} title={subscription.title} />
        </div>
      ))}
    </nav>
  )
}
