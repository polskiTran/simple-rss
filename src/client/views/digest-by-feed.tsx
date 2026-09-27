import { fetchDigestFeeds } from '../api.js'
import { CadenceStrip } from '../components/cadence-strip.js'
import { FeedTitleLink } from '../components/feed-title-link.js'
import { HomePageLink } from '../components/home-page-link.js'
import { ItemTitleLink } from '../components/item-title-link.js'
import { LoadFailure } from '../components/load-failure.js'
import { LoadingNote } from '../components/loading-note.js'
import { itemAge } from '../day-names.js'
import { useResource } from '../use-resource.js'

export interface DigestByFeedProps {
  onOpenItem(feedItemId: number): void
  onOpenFeed(feedId: number): void
}

/** A card for each Subscription with its newest items, the most recently published first. */
export function DigestByFeed({ onOpenItem, onOpenFeed }: DigestByFeedProps) {
  const [state, { retry }] = useResource(fetchDigestFeeds, [])

  if (state.kind === 'unavailable' || state.kind === 'unreachable') {
    return <LoadFailure subject="The digest" kind={state.kind} onRetry={retry} />
  }
  if (state.kind === 'loading') return <LoadingNote>Loading the digest</LoadingNote>

  const { today, feeds } = state.value
  if (feeds.length === 0) {
    return <p className="note">Nothing yet. Subscribe to a feed in Feeds to start your digest.</p>
  }
  return (
    <div className="feed-cards">
      {feeds.map((feed) => (
        <section key={feed.feedId} className="feed-card" aria-labelledby={`feed-card-${feed.feedId}`}>
          <div className="feed-card-head">
            <h2 className="feed-card-title" id={`feed-card-${feed.feedId}`}>
              <FeedTitleLink className="feed-card-name" feedId={feed.feedId} title={feed.title} onOpen={onOpenFeed} />
            </h2>
            <CadenceStrip counts={feed.cadence} title={feed.title} />
          </div>
          <HomePageLink domain={feed.domain} homePageUrl={feed.homePageUrl} />
          {feed.items.length === 0 ? (
            <p className="note">Nothing retained yet.</p>
          ) : (
            <ul className="feed-card-items">
              {feed.items.map((item) => (
                <li key={item.feedItemId} className="feed-card-item">
                  <span className="feed-card-item-title">
                    <ItemTitleLink feedItemId={item.feedItemId} title={item.title} onOpen={onOpenItem} />
                  </span>
                  <time className="feed-card-when" dateTime={item.publishedAt ?? item.firstSeenAt}>
                    {itemAge(item.date, item.displayTime, today)}
                  </time>
                </li>
              ))}
            </ul>
          )}
        </section>
      ))}
    </div>
  )
}
