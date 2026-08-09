import { routedClick } from '../routed-link.js'
import { readerPathOf } from '../routing.js'

export interface ItemTitleLinkProps {
  readonly feedItemId: number
  readonly title: string
  /** Opens the Feed Item in the Reader when the shell handles the click. */
  onOpen(feedItemId: number): void
}

/**
 * A Feed Item's title as the way into its Reader View: a real link, so
 * open-in-new-tab and copy-the-address keep working, routed by the shell for
 * a plain click. Every list that shows a title uses this one shape.
 */
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
