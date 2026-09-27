import type { ReactNode } from 'react'
import { FeedTitleLink } from './feed-title-link.js'
import { ItemTitleLink } from './item-title-link.js'
import { SaveToggle } from './save-toggle.js'

/**
 * Where a Feed Item came from, as the box names it; absent on the Feed's own
 * page. Without `onOpen` the name is plain text — a save whose Subscription is
 * gone has no Feed to open.
 */
export interface ItemFeed {
  readonly feedId: number
  readonly title: string
  readonly onOpen?: ((feedId: number) => void) | undefined
}

export interface ItemBoxProps {
  readonly feedItemId: number
  readonly title: string
  readonly saved: boolean
  readonly feed?: ItemFeed | undefined
  /** The time or date the meta column shows, and the instant it stands for. */
  readonly when: { readonly label: string; readonly dateTime: string }
  /** Search results mark their matches; everything else shows the plain title. */
  readonly titleContent?: ReactNode
  readonly snippet?: ReactNode
  onOpen(feedItemId: number): void
  onSaved(saved: boolean): void
}

/** The one shape a Feed Item takes in every list: the whole box opens the Reader. */
export function ItemBox({
  feedItemId,
  title,
  saved,
  feed,
  when,
  titleContent,
  snippet,
  onOpen,
  onSaved,
}: ItemBoxProps) {
  return (
    <article className="item" data-saved={saved ? '' : undefined}>
      <div className="item-meta">
        {feed === undefined ? null : feed.onOpen ? (
          <FeedTitleLink className="item-feed" feedId={feed.feedId} title={feed.title} onOpen={feed.onOpen} />
        ) : (
          <span className="item-feed">{feed.title}</span>
        )}
        <time className="item-when" dateTime={when.dateTime}>
          {when.label}
        </time>
      </div>
      <div className="item-body">
        <h3 className="item-title">
          <ItemTitleLink feedItemId={feedItemId} title={title} onOpen={onOpen}>
            {titleContent}
          </ItemTitleLink>
        </h3>
        {snippet ? <p className="item-snippet">{snippet}</p> : null}
      </div>
      <SaveToggle feedItemId={feedItemId} title={title} saved={saved} onSaved={onSaved} />
    </article>
  )
}
