import { routedClick } from '../routed-link.js'
import { feedPathOf } from '../routing.js'

export interface FeedTitleLinkProps {
  readonly feedId: number
  readonly title: string
  /** Opens the Feed when the shell handles the click. */
  onOpen(feedId: number): void
}

/**
 * A Feed Item's attribution, as the way into that Feed. It looks no different
 * from the plain text it replaced: meta grey, no underline at rest, stepping
 * to ink on hover like the other grey words in `docs/DESIGN.md` §5.
 */
export function FeedTitleLink({ feedId, title, onOpen }: FeedTitleLinkProps) {
  return (
    <a className="feed-title-link" href={feedPathOf(feedId)} onClick={routedClick(() => onOpen(feedId))}>
      {title}
    </a>
  )
}
