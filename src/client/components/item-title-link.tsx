import { routedClick } from '../routed-link.js'
import { readerPathOf } from '../routing.js'

export interface ItemTitleLinkProps {
  readonly feedItemId: number
  readonly title: string
  onOpen(feedItemId: number): void
}

// A real link, so open-in-new-tab and copy-the-address keep working; every
// list that shows a title uses this one shape.
export function ItemTitleLink({ feedItemId, title, onOpen }: ItemTitleLinkProps) {
  return (
    <a
      className="content-item-link"
      href={readerPathOf(feedItemId)}
      onClick={routedClick(() => onOpen(feedItemId))}
    >
      {title}
    </a>
  )
}
