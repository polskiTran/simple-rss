import { routedClick } from '../routed-link.js'
import { feedPathOf } from '../routing.js'

export interface FeedTitleLinkProps {
  readonly feedId: number
  readonly title: string
  readonly className?: string
  onOpen(feedId: number): void
}

export function FeedTitleLink({ feedId, title, className = 'feed-title-link', onOpen }: FeedTitleLinkProps) {
  return (
    <a className={className} href={feedPathOf(feedId)} onClick={routedClick(() => onOpen(feedId))}>
      {title}
    </a>
  )
}
