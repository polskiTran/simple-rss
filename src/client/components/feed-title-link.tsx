import { routedClick } from '../routed-link.js'
import { feedPathOf } from '../routing.js'

export interface FeedTitleLinkProps {
  readonly feedId: number
  readonly title: string
  onOpen(feedId: number): void
}

// Looks like the plain attribution text it replaced: meta grey, no underline
// at rest, ink on hover, per `docs/DESIGN.md` §5.
export function FeedTitleLink({ feedId, title, onOpen }: FeedTitleLinkProps) {
  return (
    <a className="feed-title-link" href={feedPathOf(feedId)} onClick={routedClick(() => onOpen(feedId))}>
      {title}
    </a>
  )
}
