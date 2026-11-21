import type { ReactNode } from 'react'
import type { SearchSubscriptionMatch } from '../../shared/api.js'
import { feedPath } from '../routing.js'
import { CadenceStrip } from './cadence-strip.js'
import { HomePageLink } from './home-page-link.js'
import { RoutedLink } from './routed-link.js'

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
      <h3 className="feed-row-name">
        <RoutedLink href={feedPath(feed.feedId)} onNavigate={() => onOpen(feed.feedId)}>
          {feed.title}
        </RoutedLink>
      </h3>
      <HomePageLink domain={feed.domain} homePageUrl={feed.homePageUrl} />
      <CadenceStrip counts={feed.cadence} title={feed.title} />
      {children}
    </article>
  )
}
