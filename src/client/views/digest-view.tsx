import { useEffect, useState } from 'react'
import type { Digest, DigestGroup } from '../../shared/api.js'
import { fetchDigest } from '../api.js'
import { DailyBand } from '../components/daily-band.js'
import { SaveToggle } from '../components/save-toggle.js'

type DigestState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'loaded'; readonly digest: Digest }
  /** The server answered — with a refusal, or a body that failed to parse. */
  | { readonly kind: 'unavailable' }
  /** No answer at all — the network, not the reader. */
  | { readonly kind: 'unreachable' }

export function DigestView() {
  const [state, setState] = useState<DigestState>({ kind: 'loading' })
  // Trying again re-runs the effect, so every attempt — the first or a retry
  // — carries the same cleanup and none can answer after unmount.
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let active = true
    setState({ kind: 'loading' })
    void fetchDigest()
      .then((digest) => {
        if (active) setState({ kind: 'loaded', digest })
      })
      .catch((error: unknown) => {
        // A rejected fetch is the network staying silent; anything else — a
        // refusal, a body that fails the schema — is the reader's problem.
        // The Owner is told which, because the way back differs: check the
        // connection, or wait for the reader.
        if (active) setState({ kind: error instanceof TypeError ? 'unreachable' : 'unavailable' })
      })
    return () => {
      active = false
    }
  }, [attempt])

  const retry = () => setAttempt((current) => current + 1)

  /** The server confirmed a membership change; the word flips in place. */
  const setSaved = (feedItemId: number, saved: boolean) =>
    setState((current) =>
      current.kind === 'loaded'
        ? {
            kind: 'loaded',
            digest: {
              ...current.digest,
              groups: current.digest.groups.map((group) => ({
                ...group,
                items: group.items.map((item) => (item.feedItemId === feedItemId ? { ...item, saved } : item)),
              })),
            },
          }
        : current,
    )

  if (state.kind === 'loading') {
    return <p className="view measure empty-note">loading the digest</p>
  }
  if (state.kind === 'unavailable' || state.kind === 'unreachable') {
    return (
      <div className="view measure">
        <p className="empty-note" role="status">
          {state.kind === 'unreachable'
            ? 'the digest is out of reach — check the connection, then try again'
            : 'the digest is unavailable — try again in a moment'}
        </p>
        <p className="digest-retry">
          <button className="text-button" type="button" onClick={retry}>
            try again
          </button>
        </p>
      </div>
    )
  }
  if (state.digest.groups.length === 0) {
    return <p className="view measure empty-note">nothing yet — subscribe to a Feed to start your digest</p>
  }

  const { today } = state.digest

  return (
    <div className="view measure digest-view digest-view-today">
      <DailyBand date={today.date} volume={today.volume} />
      {state.digest.groups.map((group) => (
        <section className="day-group" aria-labelledby={`day-${group.date}`} key={group.date}>
          <h2
            className={group.label === 'today' ? 'day-heading' : 'day-heading day-heading-past'}
            id={`day-${group.date}`}
          >
            {group.label}
            {group.label === 'today' ? (
              // The one number the design allows: it answers "is there
              // something to read", never how much is left or unread.
              <span className="day-heading-count"> · {countLabel(group)}</span>
            ) : null}
          </h2>
          <div className="content-list">
            {group.items.map((item) => (
              <article className="content-item" key={item.feedItemId}>
                <h3 className="content-item-title">{item.title}</h3>
                <div className="content-meta">
                  <span>{item.feedTitle}</span>
                  <time dateTime={item.publishedAt ?? item.firstSeenAt}>{item.displayTime}</time>
                  <SaveToggle
                    feedItemId={item.feedItemId}
                    title={item.title}
                    saved={item.saved}
                    onSaved={(saved) => setSaved(item.feedItemId, saved)}
                  />
                </div>
              </article>
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}

function countLabel(group: DigestGroup): string {
  const count = group.items.length
  return count === 1 ? '1 post' : `${count} posts`
}
