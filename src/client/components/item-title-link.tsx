import type { ReactNode } from 'react'
import { routedClick } from '../routed-link.js'
import { readerPathOf } from '../routing.js'

export interface ItemTitleLinkProps {
  readonly feedItemId: number
  readonly title: string
  /** What the link shows when it is more than the title, e.g. with matches marked. */
  readonly children?: ReactNode
  onOpen(feedItemId: number): void
}

export function ItemTitleLink({ feedItemId, title, children, onOpen }: ItemTitleLinkProps) {
  return (
    <a className="content-item-link" href={readerPathOf(feedItemId)} onClick={routedClick(() => onOpen(feedItemId))}>
      {children ?? title}
    </a>
  )
}
