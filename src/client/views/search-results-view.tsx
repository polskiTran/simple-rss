import { useState, type ReactNode } from 'react'
import { searchParamsOf, type SearchResult, type SearchScope, type SearchSubscriptionMatch } from '../../shared/api.js'
import { ApiError, fetchSearchResults } from '../api.js'
import { CadenceStrip } from '../components/cadence-strip.js'
import { Choice } from '../components/choice.js'
import { Group } from '../components/group.js'
import { HomePageLink } from '../components/home-page-link.js'
import { ItemBox } from '../components/item-box.js'
import { LoadFailure } from '../components/load-failure.js'
import { LoadingNote } from '../components/loading-note.js'
import { routedClick } from '../routed-link.js'
import { feedPathOf } from '../routing.js'
import { SEARCH_SCOPE_COPY } from '../search-scope.js'
import { useResource, valueInView } from '../use-resource.js'

export interface SearchResultsViewProps {
  settledQuery: string
  scope: SearchScope
  /** The scope of the screen the search left; the switch offers it beside everywhere. */
  originScope: SearchScope
  onScope(scope: SearchScope): void
  onOpenItem(feedItemId: number): void
  onOpenFeed(feedId: number): void
}

export function SearchResultsView({
  settledQuery,
  scope,
  originScope,
  onScope,
  onOpenItem,
  onOpenFeed,
}: SearchResultsViewProps) {
  const line = settledQuery.trim()
  const request = searchParamsOf(line, scope).toString()
  const [found, { retry, set }] = useResource((signal) => fetchSearchResults(line, scope, signal), [request])
  const [shownFeeds, setShownFeeds] = useState<ReadonlySet<number>>(new Set())
  const answer = valueInView(found)

  const setSaved = (feedItemId: number, saved: boolean) =>
    set((current) =>
      'results' in current
        ? {
            ...current,
            results: current.results.map((result) =>
              result.feedItemId === feedItemId ? { ...result, saved } : result,
            ),
          }
        : current,
    )

  const scoped = scope.kind !== 'everywhere' ? scope : originScope.kind !== 'everywhere' ? originScope : undefined
  const scopeSwitch = scoped ? (
    <Choice
      label="Search in"
      options={[
        { value: 'scoped', label: SCOPE_LABELS[scoped.kind] },
        { value: 'everywhere', label: 'Everywhere' },
      ]}
      value={scope.kind === 'everywhere' ? 'everywhere' : 'scoped'}
      onChange={(chosen) => onScope(chosen === 'everywhere' ? { kind: 'everywhere' } : scoped)}
    />
  ) : null

  const words = wordsOf(line)
  const results = answer && 'results' in answer ? answer.results : []
  const subscriptions = answer && 'subscriptions' in answer ? answer.subscriptions : []
  const feeds = feedsOf(results)
  const filtered = shownFeeds.size === 0 ? results : results.filter((result) => shownFeeds.has(result.feedId))
  const place = answer?.scope === 'feed' ? answer.feed.title : SEARCH_SCOPE_COPY[scope.kind].place

  return (
    <div className="view">
      <header className="page-head">
        <h1 className="page-title">
          “{line}”
          {answer ? (
            <span className="page-title-companion">
              {answer.scope === 'subscriptions'
                ? countOf(subscriptions.length, 'feed')
                : countOf(results.length, 'result')}
              {answer.scope === 'feed' ? ` in ${answer.feed.title}` : null}
            </span>
          ) : null}
        </h1>
        {scopeSwitch ? <div className="toolbar">{scopeSwitch}</div> : null}
      </header>

      {found.kind === 'unreachable' || found.kind === 'unavailable' ? (
        found.error instanceof ApiError && found.error.status === 404 ? (
          <p className="note" role="status">
            That feed is gone. Search everywhere instead.
          </p>
        ) : (
          <LoadFailure subject="Search" kind={found.kind} onRetry={retry} />
        )
      ) : answer === undefined ? (
        <LoadingNote announce>Searching…</LoadingNote>
      ) : subscriptions.length === 0 && results.length === 0 ? (
        <p className="note" role="status">
          Nothing in {place} matches “{line}”.
        </p>
      ) : (
        <div className="search-answer" role="region" aria-label="search results" aria-busy={found.kind === 'loading'}>
          <div>
            <MatchingFeeds subscriptions={subscriptions} onOpenFeed={onOpenFeed} />
            {filtered.length > 0 ? (
              <div className="item-list">
                {filtered.map((result) => (
                  <ItemBox
                    key={result.feedItemId}
                    feedItemId={result.feedItemId}
                    title={result.title}
                    titleContent={marked(result.title, words)}
                    snippet={result.snippet === null ? undefined : marked(result.snippet, words)}
                    saved={result.saved}
                    feed={
                      answer.scope === 'feed'
                        ? undefined
                        : { feedId: result.feedId, title: result.feedTitle, onOpen: onOpenFeed }
                    }
                    when={{ label: result.displayDate, dateTime: result.publishedAt ?? result.firstSeenAt }}
                    onOpen={onOpenItem}
                    onSaved={(saved) => setSaved(result.feedItemId, saved)}
                  />
                ))}
              </div>
            ) : null}
          </div>
          {feeds.length > 1 ? <FeedFilter feeds={feeds} shown={shownFeeds} onChange={setShownFeeds} /> : null}
        </div>
      )}
    </div>
  )
}

const SCOPE_LABELS = {
  saved: 'Saved',
  subscriptions: 'Feeds',
  feed: 'This feed',
} as const satisfies Record<Exclude<SearchScope['kind'], 'everywhere'>, string>

function countOf(count: number, noun: string): string {
  return count === 1 ? `1 ${noun}` : `${count} ${noun}s`
}

/** The Feeds the results came from, most results first. */
function feedsOf(results: readonly SearchResult[]) {
  return [...Map.groupBy(results, (result) => result.feedId)]
    .map(([feedId, matches]) => ({ feedId, title: matches[0]?.feedTitle ?? '', count: matches.length }))
    .sort((left, right) => right.count - left.count || left.title.localeCompare(right.title))
}

/** Ticked Feeds narrow the results to themselves; none ticked shows every result. */
function FeedFilter({
  feeds,
  shown,
  onChange,
}: {
  feeds: readonly { feedId: number; title: string; count: number }[]
  shown: ReadonlySet<number>
  onChange: (shown: ReadonlySet<number>) => void
}) {
  const toggle = (feedId: number) => {
    const next = new Set(shown)
    if (next.has(feedId)) next.delete(feedId)
    else next.add(feedId)
    onChange(next)
  }

  return (
    <aside className="search-filter" aria-label="Narrow by feed">
      <Group
        id="search-feeds"
        title="Feeds"
        className="panel"
        aside={
          shown.size > 0 ? (
            <button type="button" className="button button-ghost button-small" onClick={() => onChange(new Set())}>
              Clear
            </button>
          ) : undefined
        }
      >
        <ul className="filter-list">
          {feeds.map((feed) => (
            <li key={feed.feedId}>
              <label className="filter-row">
                <input
                  type="checkbox"
                  className="checkbox"
                  checked={shown.has(feed.feedId)}
                  onChange={() => toggle(feed.feedId)}
                />
                <span className="filter-name">{feed.title}</span>
                <span className="filter-count">{feed.count}</span>
              </label>
            </li>
          ))}
        </ul>
      </Group>
    </aside>
  )
}

/** Subscriptions the words matched by name or host, as a way into each Feed. */
function MatchingFeeds({
  subscriptions,
  onOpenFeed,
}: {
  subscriptions: readonly SearchSubscriptionMatch[]
  onOpenFeed: (feedId: number) => void
}) {
  if (subscriptions.length === 0) return null

  return (
    <nav className="search-feeds" aria-label="matching subscriptions">
      <Group id="search-matching-feeds" title="Feeds" count={subscriptions.length}>
        <div className="feed-rows">
          {subscriptions.map((subscription) => (
            <article className="feed-row" key={subscription.feedId}>
              <div className="feed-row-head">
                <h3 className="feed-row-name">
                  <a
                    href={feedPathOf(subscription.feedId)}
                    onClick={routedClick(() => onOpenFeed(subscription.feedId))}
                  >
                    {subscription.title}
                  </a>
                </h3>
                <CadenceStrip counts={subscription.cadence} title={subscription.title} />
              </div>
              <HomePageLink
                className="feed-row-domain"
                domain={subscription.domain}
                homePageUrl={subscription.homePageUrl}
              />
            </article>
          ))}
        </div>
      </Group>
    </nav>
  )
}

/** The query's words, as the server's tokenizer would count them. */
function wordsOf(line: string): string[] {
  return line
    .split(/\s+/)
    .map((word) => word.replace(/^["“”']+|["“”']+$/g, ''))
    .filter((word) => word.length > 1)
}

/** The text with every occurrence of the words marked, whatever their case. */
function marked(text: string, words: readonly string[]): ReactNode {
  if (words.length === 0) return text
  const pattern = new RegExp(`(${words.map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'gi')
  const parts = text.split(pattern)
  return parts.map((part, index) =>
    // Split with one capture group: odd indices are the matches.
    index % 2 === 1 ? (
      // biome-ignore lint/suspicious/noArrayIndexKey: the parts of one fixed string, in order — the position is the identity.
      <mark key={index} className="match">
        {part}
      </mark>
    ) : (
      part
    ),
  )
}
