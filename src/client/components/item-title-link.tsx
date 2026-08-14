import { routedClick } from '../routed-link.js'
import { readerPathOf } from '../routing.js'

export interface ItemTitleLinkProps {
  readonly feedItemId: number
  readonly title: string
  onOpen(feedItemId: number): void
}

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
