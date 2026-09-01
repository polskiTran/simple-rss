import type { SearchSubscriptionMatch } from '../../shared/api.js'
import { fetchSearchResults } from '../api.js'
import { CadenceStrip } from '../components/cadence-strip.js'
import { FeedTitleLink } from '../components/feed-title-link.js'
import { HomePageLink } from '../components/home-page-link.js'
import { ItemTitleLink } from '../components/item-title-link.js'
import { LoadingNote } from '../components/loading-note.js'
import { SaveToggle } from '../components/save-toggle.js'
import { routedClick } from '../routed-link.js'
import { feedPathOf } from '../routing.js'
import { useResource } from '../use-resource.js'

export interface SearchResultsViewProps {
  settledQuery: string
  onOpenItem(feedItemId: number): void
  onOpenFeed(feedId: number): void
}

export function SearchResultsView({ settledQuery, onOpenItem, onOpenFeed }: SearchResultsViewProps) {
  const line = settledQuery.trim()
  const [found, { set }] = useResource((signal) => fetchSearchResults(line, signal), [line])

  const setSaved = (feedItemId: number, saved: boolean) =>
    set((current) => ({
      ...current,
      results: current.results.map((result) => (result.feedItemId === feedItemId ? { ...result, saved } : result)),
    }))

  const outcome = () => {
    if (found.kind === 'loading') {
      return (
        <LoadingNote className="empty-note" announce>
          searching…
        </LoadingNote>
      )
    }
    if (found.kind !== 'loaded') {
      return (
        <p className="empty-note" role="status">
          {found.kind === 'unreachable'
            ? 'search is out of reach — check the connection, then try again'
            : 'search is unavailable — try again in a moment'}
        </p>
      )
    }

    const { subscriptions, results } = found.value
    if (subscriptions.length === 0 && results.length === 0) {
      return (
        <p className="empty-note" role="status">
          nothing in your reading matches “{line}”
        </p>
      )
    }

    return (
      <div className="search-answer" role="region" aria-label="search results">
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
                  <FeedTitleLink feedId={result.feedId} title={result.feedTitle} onOpen={onOpenFeed} />
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
    )
  }

  return <div className="view measure search-results-view">{outcome()}</div>
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
