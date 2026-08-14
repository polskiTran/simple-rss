import { useEffect, useState } from 'react'
import { MAX_SEARCH_QUERY_LENGTH, type Digest, type SearchResult } from '../../shared/api.js'
import { fetchDigest, fetchSearchResults } from '../api.js'
import { DailyBand } from '../components/daily-band.js'
import { FeedTitleLink } from '../components/feed-title-link.js'
import { ItemTitleLink } from '../components/item-title-link.js'
import { LoadingNote } from '../components/loading-note.js'
import { OlderItems, type OlderState } from '../components/older-items.js'
import { SaveToggle } from '../components/save-toggle.js'
import { failureKind } from './failure.js'

export interface DigestViewProps {
  onOpenItem(feedItemId: number): void
  onOpenFeed(feedId: number): void
}

type DigestState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'loaded'; readonly digest: Digest }
  | { readonly kind: 'unavailable' }
  | { readonly kind: 'unreachable' }

type SearchState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'searching' }
  | { readonly kind: 'found'; readonly results: readonly SearchResult[] }
  | { readonly kind: 'unavailable' }
  | { readonly kind: 'unreachable' }

const SEARCH_SETTLE_MS = 250

function withOlderPage(digest: Digest, page: Digest): Digest {
  const groups = [...digest.groups]
  const seam = groups.at(-1)
  const [first, ...rest] = page.groups
  if (seam && first && first.date === seam.date) {
    groups[groups.length - 1] = { ...seam, items: [...seam.items, ...first.items] }
    groups.push(...rest)
  } else {
    groups.push(...page.groups)
  }
  return { ...digest, groups, nextCursor: page.nextCursor }
}

export function DigestView({ onOpenItem, onOpenFeed }: DigestViewProps) {
  const [state, setState] = useState<DigestState>({ kind: 'loading' })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let active = true
    setState({ kind: 'loading' })
    setOlder('idle')
    void fetchDigest()
      .then((digest) => {
        if (active) setState({ kind: 'loaded', digest })
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
    void fetchDigest(cursor)
      .then((page) => {
        setOlder('idle')
        setState((current) =>
          current.kind === 'loaded' ? { kind: 'loaded', digest: withOlderPage(current.digest, page) } : current,
        )
      })
      .catch(() => setOlder('failed'))
  }

  const [query, setQuery] = useState('')
  const [search, setSearch] = useState<SearchState>({ kind: 'idle' })
  const line = query.trim()

  useEffect(() => {
    if (line === '') {
      setSearch({ kind: 'idle' })
      return
    }
    let active = true
    setSearch({ kind: 'searching' })
    const settle = window.setTimeout(() => {
      void fetchSearchResults(line)
        .then((found) => {
          if (active) setSearch({ kind: 'found', results: found.results })
        })
        .catch((error: unknown) => {
          if (active) setSearch({ kind: failureKind(error) })
        })
    }, SEARCH_SETTLE_MS)
    return () => {
      active = false
      window.clearTimeout(settle)
    }
  }, [line])

  const retry = () => setAttempt((current) => current + 1)

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
    return <LoadingNote className="view measure empty-note">loading the digest</LoadingNote>
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
                  <span className="day-heading-count"> · {countLabel(state.digest.today.volume)}</span>
                ) : null}
              </h2>
              <div className="content-list">
                {group.items.map((item) => (
                  <article className="content-item" key={item.feedItemId}>
                    <h3 className="content-item-title">
                      <ItemTitleLink feedItemId={item.feedItemId} title={item.title} onOpen={onOpenItem} />
                    </h3>
                    <div className="content-meta">
                      <FeedTitleLink feedId={item.feedId} title={item.feedTitle} onOpen={onOpenFeed} />
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
          <OlderItems nextCursor={state.digest.nextCursor} older={older} noun="items" onLoadOlder={loadOlder} />
        </>
      ) : (
        <SearchOutcome state={search} line={line} onOpenItem={onOpenItem} onOpenFeed={onOpenFeed} onSaved={setSaved} />
      )}
    </div>
  )
}

function SearchOutcome({
  state,
  line,
  onOpenItem,
  onOpenFeed,
  onSaved,
}: {
  state: Exclude<SearchState, { kind: 'idle' }>
  line: string
  onOpenItem: (feedItemId: number) => void
  onOpenFeed: (feedId: number) => void
  onSaved: (feedItemId: number, saved: boolean) => void
}) {
  if (state.kind === 'searching') {
    return (
      <LoadingNote className="empty-note" announce>
        searching…
      </LoadingNote>
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
            <FeedTitleLink feedId={result.feedId} title={result.feedTitle} onOpen={onOpenFeed} />
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

function countLabel(count: number): string {
  return count === 1 ? '1 post' : `${count} posts`
}
