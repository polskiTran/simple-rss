import { useEffect, useState } from 'react'
import type { Library } from '../../shared/api.js'
import { fetchLibrary } from '../api.js'
import { SaveToggle } from '../components/save-toggle.js'

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
export function SavedView() {
  const [state, setState] = useState<LibraryState>({ kind: 'loading' })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let active = true
    setState({ kind: 'loading' })
    void fetchLibrary()
      .then((library) => {
        if (active) setState({ kind: 'loaded', library })
      })
      .catch((error: unknown) => {
        // A rejected fetch is the network staying silent; anything else — a
        // refusal, a body that fails the schema — is the reader's problem.
        if (active) setState({ kind: error instanceof TypeError ? 'unreachable' : 'unavailable' })
      })
    return () => {
      active = false
    }
  }, [attempt])

  // Membership changes made on this screen, kept beside the fetched list so
  // an unsaved row stays visible — and reversible — until the next visit.
  const [membership, setMembership] = useState<ReadonlyMap<number, boolean>>(new Map())
  const setSaved = (feedItemId: number, saved: boolean) =>
    setMembership((current) => new Map(current).set(feedItemId, saved))

  const retry = () => setAttempt((current) => current + 1)

  if (state.kind === 'loading') {
    return <p className="view measure empty-note">loading the library</p>
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
            <h2 className="content-item-title">{item.title}</h2>
            <div className="content-meta">
              <span>{item.feedTitle}</span>
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
    </div>
  )
}
