import type { ReactNode } from 'react'
import { feedPath, readerPath } from '../routing.js'
import { RoutedLink } from './routed-link.js'
import { SaveToggle } from './save-toggle.js'

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
  readonly when: { readonly label: string | null; readonly dateTime: string }
  readonly titleContent?: ReactNode
  readonly snippet?: ReactNode
  onOpen(feedItemId: number): void
  onSaved(saved: boolean): void
}

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
  const openFeed = feed?.onOpen
  return (
    <article className="item">
      <div className="item-meta">
        {feed === undefined ? null : openFeed ? (
          <RoutedLink className="item-feed" href={feedPath(feed.feedId)} onNavigate={() => openFeed(feed.feedId)}>
            <FeedName title={feed.title} />
          </RoutedLink>
        ) : (
          <span className="item-feed">
            <FeedName title={feed.title} />
          </span>
        )}
        {when.label === null ? null : (
          <time className="item-when" dateTime={when.dateTime}>
            {when.label}
          </time>
        )}
      </div>
      <div className="item-body">
        <h3 className="item-title">
          <RoutedLink href={readerPath(feedItemId)} onNavigate={() => onOpen(feedItemId)}>
            <span className="item-text">{titleContent ?? title}</span>
          </RoutedLink>
        </h3>
        {snippet ? <p className="item-snippet">{snippet}</p> : null}
      </div>
      <SaveToggle feedItemId={feedItemId} title={title} saved={saved} onSaved={onSaved} />
    </article>
  )
}

export function FeedName({ title }: { title: string }) {
  return (
    <span className="item-feed-name" title={title}>
      {title}
    </span>
  )
}
