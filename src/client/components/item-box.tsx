import type { ReactNode } from 'react'
import { feedPath, readerPath } from '../routing.js'
import { RoutedLink } from './routed-link.js'
import { SaveToggle } from './save-toggle.js'

/**
 * Where a Feed Item came from, as the box names it; absent on the Feed's own
 * page. Without `onOpen` the name is plain text — a save whose Subscription is
 * gone has no Feed to open.
 */
interface ItemFeed {
  readonly feedId: number
  readonly title: string
  readonly onOpen?: ((feedId: number) => void) | undefined
}

interface ItemBoxProps {
  readonly feedItemId: number
  readonly title: string
  readonly saved: boolean
  readonly feed?: ItemFeed | undefined
  /** The time or date the meta column shows, and the instant it stands for. */
  readonly when: { readonly label: string; readonly dateTime: string }
  /** Search results mark their matches; everything else shows the plain title. */
  readonly titleContent?: ReactNode
  readonly snippet?: ReactNode
  /** Said under the time, in the meta column. */
  readonly note?: ReactNode
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
  note,
  onOpen,
  onSaved,
}: ItemBoxProps) {
  const openFeed = feed?.onOpen
  return (
    <article className="item" data-saved={saved ? '' : undefined}>
      <div className="item-meta">
        {feed === undefined ? null : openFeed ? (
          <RoutedLink className="item-feed" href={feedPath(feed.feedId)} onNavigate={() => openFeed(feed.feedId)}>
            {feed.title}
          </RoutedLink>
        ) : (
          <span className="item-feed">{feed.title}</span>
        )}
        <time className="item-when" dateTime={when.dateTime}>
          {when.label}
        </time>
        {note}
      </div>
      <div className="item-body">
        <h3 className="item-title">
          <RoutedLink href={readerPath(feedItemId)} onNavigate={() => onOpen(feedItemId)}>
            {titleContent ?? title}
          </RoutedLink>
        </h3>
        {snippet ? <p className="item-snippet">{snippet}</p> : null}
      </div>
      <SaveToggle feedItemId={feedItemId} title={title} saved={saved} onSaved={onSaved} />
    </article>
  )
}
