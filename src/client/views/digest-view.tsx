import { useEffect, useState } from 'react'
import { MAX_SEARCH_QUERY_LENGTH, type Digest, type DigestGroup, type SearchResult } from '../../shared/api.js'
import { fetchDigest, fetchSearchResults } from '../api.js'
import { DailyBand } from '../components/daily-band.js'
import { ItemTitleLink } from '../components/item-title-link.js'
import { SaveToggle } from '../components/save-toggle.js'

export interface DigestViewProps {
  /** Opens one Feed Item in the Reader. */
  onOpenItem(feedItemId: number): void
}

type DigestState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'loaded'; readonly digest: Digest }
  /** The server answered — with a refusal, or a body that failed to parse. */
  | { readonly kind: 'unavailable' }
  /** No answer at all — the network, not the reader. */
  | { readonly kind: 'unreachable' }

type SearchState =
  /** The field is empty; the Digest itself is what shows. */
  | { readonly kind: 'idle' }
  | { readonly kind: 'searching' }
  | { readonly kind: 'found'; readonly results: readonly SearchResult[] }
  | { readonly kind: 'unavailable' }
  | { readonly kind: 'unreachable' }

/** How long typing rests before the line is asked of the server. */
const SEARCH_SETTLE_MS = 250

export function DigestView({ onOpenItem }: DigestViewProps) {
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

  const [query, setQuery] = useState('')
  const [search, setSearch] = useState<SearchState>({ kind: 'idle' })
  const line = query.trim()

  useEffect(() => {
    if (line === '') {
      setSearch({ kind: 'idle' })
      return
    }
    let active = true
    // Searching, immediately: the settle delay batches keystrokes into one
    // request, and the state must not claim stale results meanwhile.
    setSearch({ kind: 'searching' })
    const settle = window.setTimeout(() => {
      void fetchSearchResults(line)
        .then((found) => {
          if (active) setSearch({ kind: 'found', results: found.results })
        })
        .catch((error: unknown) => {
          if (active) setSearch({ kind: error instanceof TypeError ? 'unreachable' : 'unavailable' })
        })
    }, SEARCH_SETTLE_MS)
    return () => {
      active = false
      window.clearTimeout(settle)
    }
  }, [line])

  const retry = () => setAttempt((current) => current + 1)

  /** The server confirmed a membership change; the word flips in place. */
  const setSaved = (feedItemId: number, saved: boolean) => {
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
    // The same item may be on screen as a search result; the two must agree.
    setSearch((current) =>
      current.kind === 'found'
        ? {
            kind: 'found',
            results: current.results.map((result) =>
              result.feedItemId === feedItemId ? { ...result, saved } : result,
            ),
          }
        : current,
    )
  }

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
      <form className="search-form" role="search" onSubmit={(event) => event.preventDefault()}>
        <input
          className="field-input search-input"
          type="search"
          autoComplete="off"
          spellCheck={false}
          maxLength={MAX_SEARCH_QUERY_LENGTH}
          aria-label="search your reading"
          placeholder="search your reading"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </form>
      {search.kind === 'idle' ? (
        <>
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
                    <h3 className="content-item-title">
                      <ItemTitleLink feedItemId={item.feedItemId} title={item.title} onOpen={onOpenItem} />
                    </h3>
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
        </>
      ) : (
        <SearchOutcome state={search} line={line} onOpenItem={onOpenItem} onSaved={setSaved} />
      )}
    </div>
  )
}

/**
 * What a non-empty search line shows in the Digest's place. Every state is a
 * said thing — searching, unreachable, nothing matched — so silence is never
 * mistaken for an answer, and results keep the one content-item shape with
 * the Feed and date that tell similar titles apart.
 */
function SearchOutcome({
  state,
  line,
  onOpenItem,
  onSaved,
}: {
  state: Exclude<SearchState, { kind: 'idle' }>
  line: string
  onOpenItem: (feedItemId: number) => void
  onSaved: (feedItemId: number, saved: boolean) => void
}) {
  if (state.kind === 'searching') {
    return (
      <p className="empty-note" role="status">
        searching…
      </p>
    )
  }
  if (state.kind === 'unavailable' || state.kind === 'unreachable') {
    return (
      <p className="empty-note" role="status">
        {state.kind === 'unreachable'
          ? 'search is out of reach — check the connection, then try again'
          : 'search is unavailable — try again in a moment'}
      </p>
    )
  }
  if (state.results.length === 0) {
    return (
      <p className="empty-note" role="status">
        nothing in your reading matches “{line}”
      </p>
    )
  }

  return (
    <div className="content-list" role="region" aria-label="search results">
      {state.results.map((result) => (
        <article className="content-item" key={result.feedItemId}>
          <h3 className="content-item-title">
            <ItemTitleLink feedItemId={result.feedItemId} title={result.title} onOpen={onOpenItem} />
          </h3>
          <div className="content-meta">
            <span>{result.feedTitle}</span>
            <time dateTime={result.publishedAt ?? result.firstSeenAt}>{result.displayDate}</time>
            <SaveToggle
              feedItemId={result.feedItemId}
              title={result.title}
              saved={result.saved}
              onSaved={(saved) => onSaved(result.feedItemId, saved)}
            />
          </div>
        </article>
      ))}
    </div>
  )
}

function countLabel(group: DigestGroup): string {
  const count = group.items.length
  return count === 1 ? '1 post' : `${count} posts`
}
