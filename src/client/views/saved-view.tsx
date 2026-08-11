import { useEffect, useState } from 'react'
import type { Library } from '../../shared/api.js'
import { fetchLibrary } from '../api.js'
import { ItemTitleLink } from '../components/item-title-link.js'
import { LoadingNote } from '../components/loading-note.js'
import { OlderItems, type OlderState } from '../components/older-items.js'
import { SaveToggle } from '../components/save-toggle.js'
import { failureKind } from './failure.js'

export interface SavedViewProps {
  /** Opens one saved Feed Item in the Reader. */
  onOpenItem(feedItemId: number): void
}

type LibraryState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'loaded'; readonly library: Library }
  /** The server answered — with a refusal, or a body that failed to parse. */
  | { readonly kind: 'unavailable' }
  /** No answer at all — the network, not the reader. */
  | { readonly kind: 'unreachable' }

/**
 * The Saved tab: the Library in the same content shape as the Digest, with
 * source attribution and the item's own chronology. Unsaving here flips the
 * word in place; the row leaves the list on the next visit, so a misread tap
 * can be undone where it happened.
 */
export function SavedView({ onOpenItem }: SavedViewProps) {
  const [state, setState] = useState<LibraryState>({ kind: 'loading' })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let active = true
    setState({ kind: 'loading' })
    setOlder('idle')
    void fetchLibrary()
      .then((library) => {
        if (active) setState({ kind: 'loaded', library })
      })
      .catch((error: unknown) => {
        if (active) setState({ kind: failureKind(error) })
      })
    return () => {
      active = false
    }
  }, [attempt])

  const [older, setOlder] = useState<OlderState>('idle')

  const loadOlder = (cursor: string) => {
    setOlder('loading')
    void fetchLibrary(cursor)
      .then((page) => {
        setOlder('idle')
        setState((current) =>
          current.kind === 'loaded'
            ? {
                kind: 'loaded',
                library: { items: [...current.library.items, ...page.items], nextCursor: page.nextCursor },
              }
            : current,
        )
      })
      .catch(() => setOlder('failed'))
  }

  // Membership changes made on this screen, kept beside the fetched list so
  // an unsaved row stays visible — and reversible — until the next visit.
  const [membership, setMembership] = useState<ReadonlyMap<number, boolean>>(new Map())
  const setSaved = (feedItemId: number, saved: boolean) =>
    setMembership((current) => new Map(current).set(feedItemId, saved))

  const retry = () => setAttempt((current) => current + 1)

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
          <button className="text-button" type="button" onClick={retry}>
            try again
          </button>
        </p>
      </div>
    )
  }
  if (state.library.items.length === 0) {
    return (
      <p className="view measure empty-note">
        nothing saved yet — save an item from the digest or a feed to keep it here
      </p>
    )
  }

  return (
    <div className="view measure">
      <div className="content-list">
        {state.library.items.map((item) => (
          <article className="content-item" key={item.feedItemId}>
            <h2 className="content-item-title">
              <ItemTitleLink feedItemId={item.feedItemId} title={item.title} onOpen={onOpenItem} />
            </h2>
            <div className="content-meta">
              {/* A save outlives its Subscription; said as a fact, not a nudge
                  to clean anything up. */}
              <span>{item.subscribed ? item.feedTitle : `${item.feedTitle} · no longer subscribed`}</span>
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
      <OlderItems nextCursor={state.library.nextCursor} older={older} noun="saves" onLoadOlder={loadOlder} />
    </div>
  )
}
