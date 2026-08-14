import { useState } from 'react'
import { fetchLibrary } from '../api.js'
import { FeedTitleLink } from '../components/feed-title-link.js'
import { ItemTitleLink } from '../components/item-title-link.js'
import { LoadingNote } from '../components/loading-note.js'
import { OlderItems, type OlderState } from '../components/older-items.js'
import { SaveToggle } from '../components/save-toggle.js'
import { useResource } from '../use-resource.js'

export interface SavedViewProps {
  onOpenItem(feedItemId: number): void
  onOpenFeed(feedId: number): void
}

export function SavedView({ onOpenItem, onOpenFeed }: SavedViewProps) {
  const [state, { retry, set }] = useResource((signal) => fetchLibrary(undefined, signal), [])
  const [older, setOlder] = useState<OlderState>('idle')

  const loadOlder = (cursor: string) => {
    setOlder('loading')
    void fetchLibrary(cursor)
      .then((page) => {
        setOlder('idle')
        set((library) => ({ items: [...library.items, ...page.items], nextCursor: page.nextCursor }))
      })
      .catch(() => setOlder('failed'))
  }

  const [membership, setMembership] = useState<ReadonlyMap<number, boolean>>(new Map())
  const setSaved = (feedItemId: number, saved: boolean) =>
    setMembership((current) => new Map(current).set(feedItemId, saved))

  const tryAgain = () => {
    setOlder('idle')
    retry()
  }

  if (state.kind === 'loading') {
    return <LoadingNote className="view measure empty-note">loading the library</LoadingNote>
  }
  if (state.kind === 'unavailable' || state.kind === 'unreachable') {
    return (
      <div className="view measure">
        <p className="empty-note" role="status">
          {state.kind === 'unreachable'
            ? 'the library is out of reach — check the connection, then try again'
            : 'the library is unavailable — try again in a moment'}
        </p>
        <p className="digest-retry">
          <button className="text-button" type="button" onClick={tryAgain}>
            try again
          </button>
        </p>
      </div>
    )
  }

  const library = state.value
  if (library.items.length === 0) {
    return (
      <p className="view measure empty-note">
        nothing saved yet — save an item from the digest or a feed to keep it here
      </p>
    )
  }

  return (
    <div className="view measure">
      <div className="content-list">
        {library.items.map((item) => (
          <article className="content-item" key={item.feedItemId}>
            <h2 className="content-item-title">
              <ItemTitleLink feedItemId={item.feedItemId} title={item.title} onOpen={onOpenItem} />
            </h2>
            <div className="content-meta">
              {item.subscribed ? (
                <FeedTitleLink feedId={item.feedId} title={item.feedTitle} onOpen={onOpenFeed} />
              ) : (
                <span>{item.feedTitle} · no longer subscribed</span>
              )}
              <time dateTime={item.publishedAt ?? item.firstSeenAt}>{item.displayDate}</time>
              <SaveToggle
                feedItemId={item.feedItemId}
                title={item.title}
                saved={membership.get(item.feedItemId) ?? true}
                onSaved={(saved) => setSaved(item.feedItemId, saved)}
              />
            </div>
          </article>
        ))}
      </div>
      <OlderItems nextCursor={library.nextCursor} older={older} noun="saves" onLoadOlder={loadOlder} />
    </div>
  )
}
