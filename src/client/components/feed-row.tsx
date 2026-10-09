import type { ReactNode } from 'react'
import type { SearchSubscriptionMatch } from '../../shared/api.js'
import { feedPath } from '../routing.js'
import { CadenceStrip } from './cadence-strip.js'
import { HomePageLink } from './home-page-link.js'
import { RoutedLink } from './routed-link.js'

/**
 * A Subscription as a way into its Feed: its name, its last 30 days and its
 * site. The Feeds list adds what it knows of availability underneath.
 */
export function FeedRow({
  feed,
  onOpen,
  children,
}: {
  feed: SearchSubscriptionMatch
  onOpen(feedId: number): void
  children?: ReactNode
}) {
  return (
    <article className="feed-row">
      <div className="feed-row-head">
        <h3 className="feed-row-name">
          <RoutedLink href={feedPath(feed.feedId)} onNavigate={() => onOpen(feed.feedId)}>
            {feed.title}
          </RoutedLink>
        </h3>
        <CadenceStrip counts={feed.cadence} title={feed.title} />
      </div>
      <HomePageLink domain={feed.domain} homePageUrl={feed.homePageUrl} />
      {children}
    </article>
  )
}
