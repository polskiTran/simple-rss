import { Button } from '@base-ui/react/button'
import type { ReactNode } from 'react'
import {
  type MarkedText,
  type SearchResult,
  type SearchScope,
  type SearchSort,
  searchParamsOf,
} from '../../shared/api.js'
import type { Rhythm } from '../../shared/rhythm.js'
import { useScreenTitle } from '../arrival.js'
import { ApiError, fetchSearchResults } from '../api.js'
import { withSaved } from '../components/save-toggle.js'
import { counted, dayAndTime } from '../day-names.js'
import { SEARCH_SCOPE_COPY } from '../search-scope.js'
import { useResource, valueInView } from '../use-resource.js'
import { FeedLink, FeedRow, LedgerRow, LoadFailure, Options, SaveWord, TitleLink, useRhythmOf } from './parts.js'

const SCOPE_LABELS = {
  everywhere: 'Everywhere',
  saved: 'Library',
  subscriptions: 'Feeds',
  feed: 'This Feed',
} as const satisfies Record<SearchScope['kind'], string>

interface SearchScreenProps {
  readonly query: string
  readonly scope: SearchScope
  readonly sort: SearchSort
  readonly originScope: SearchScope
  onScope(scope: SearchScope): void
  onSort(sort: SearchSort): void
  onOpenItem(feedItemId: number): void
  onOpenFeed(feedId: number): void
}

export function SearchScreen({
  query,
  scope,
  sort,
  originScope,
  onScope,
  onSort,
  onOpenItem,
  onOpenFeed,
}: SearchScreenProps) {
  useScreenTitle('Search')
  const line = query.trim()
  const [found, { retry, set }] = useResource(searchParamsOf(line, scope, sort).toString(), (signal) =>
    fetchSearchResults(line, scope, sort, signal),
  )
  const rhythmOf = useRhythmOf()
  const answer = valueInView(found)
  const results = answer && 'results' in answer ? answer.results : []
  const subscriptions = answer && 'subscriptions' in answer ? answer.subscriptions : []
  const scoped = scope.kind !== 'everywhere' ? scope : originScope.kind !== 'everywhere' ? originScope : undefined
  const place = answer?.scope === 'feed' ? answer.feed.title : SEARCH_SCOPE_COPY[scope.kind].place
  const gone = found.kind === 'unavailable' && found.error instanceof ApiError && found.error.status === 404
  const failed = found.kind === 'unavailable' || found.kind === 'unreachable'
  const tally = answer
    ? answer.scope === 'subscriptions'
      ? counted(subscriptions.length, 'Feed')
      : counted(results.length, 'Feed Item')
    : failed
      ? null
      : `Searching ${place}`
  const saved = (feedItemId: number, isSaved: boolean) =>
    set((current) =>
      'results' in current ? { ...current, results: withSaved(current.results, feedItemId, isSaved) } : current,
    )

  return (
    <div className="x-screen">
      <header className="x-ledger">
        <LedgerRow label="Search">
          <h1 className="x-search-query">“{line}”</h1>{' '}
          <span className="x-grey" role="status">
            {tally}
          </span>
        </LedgerRow>
        {scoped ? (
          <LedgerRow label="In">
            <Options
              label="Search in"
              options={[
                {
                  value: 'scoped',
                  label: answer?.scope === 'feed' ? answer.feed.title : SCOPE_LABELS[scoped.kind],
                },
                { value: 'everywhere', label: SCOPE_LABELS.everywhere },
              ]}
              value={scope.kind === 'everywhere' ? 'everywhere' : 'scoped'}
              onChange={(chosen) => onScope(chosen === 'everywhere' ? { kind: 'everywhere' } : scoped)}
            />
          </LedgerRow>
        ) : null}
        {scope.kind === 'subscriptions' ? null : (
          <LedgerRow label="Order">
            <Options
              label="Sort results"
              options={[
                { value: 'best', label: 'Best match' },
                { value: 'newest', label: 'Newest' },
              ]}
              value={sort}
              onChange={onSort}
            />
          </LedgerRow>
        )}
        {gone ? (
          <LedgerRow label="">
            That Feed isn’t among your Subscriptions.{' '}
            <Button className="x-more" onClick={() => onScope({ kind: 'everywhere' })}>
              Search everywhere
            </Button>
          </LedgerRow>
        ) : found.kind === 'unavailable' || found.kind === 'unreachable' ? (
          <LedgerRow label="">
            <LoadFailure subject="The search" kind={found.kind} onRetry={retry} />
          </LedgerRow>
        ) : answer && results.length === 0 && subscriptions.length === 0 ? (
          <LedgerRow label="">
            <span role="status">Nothing in {place} matches.</span>
          </LedgerRow>
        ) : null}
      </header>

      {answer ? (
        <section aria-label="Search results" aria-busy={found.kind === 'loading'}>
          {subscriptions.length > 0 ? (
            <section className="x-day x-grid" aria-labelledby="search-feeds">
              <h2 className="x-day-label" id="search-feeds">
                Feeds
              </h2>
              <div className="x-rows">
                {subscriptions.map((feed) => (
                  <FeedRow key={feed.feedId} feed={feed} onOpen={onOpenFeed} />
                ))}
              </div>
            </section>
          ) : null}
          {[...Map.groupBy(results, (result) => result.feedId)].map(([feedId, matches]) => (
            <FeedMatches
              key={feedId}
              feedId={feedId}
              matches={matches}
              today={answer.today}
              rhythm={rhythmOf(feedId)}
              narrowed={scope.kind !== 'everywhere'}
              onNarrow={() => onScope({ kind: 'feed', feedId })}
              onOpenItem={onOpenItem}
              onOpenFeed={onOpenFeed}
              onSaved={saved}
            />
          ))}
        </section>
      ) : null}

      {results.length > 0 ? (
        <div className="x-legend x-grid" data-plain="" aria-hidden="true">
          <span className="x-c-label">Feed</span>
          <span className="x-legend-title">Title</span>
          <span className="x-legend-time">Day</span>
        </div>
      ) : null}
    </div>
  )
}

function FeedMatches({
  feedId,
  matches,
  today,
  rhythm,
  narrowed,
  onNarrow,
  onOpenItem,
  onOpenFeed,
  onSaved,
}: {
  readonly feedId: number
  readonly matches: readonly SearchResult[]
  readonly today: SearchResult['date']
  readonly rhythm: Rhythm
  readonly narrowed: boolean
  onNarrow(): void
  onOpenItem(feedItemId: number): void
  onOpenFeed(feedId: number): void
  onSaved(feedItemId: number, saved: boolean): void
}) {
  const [first] = matches
  if (!first) return null
  const heading = `search-feed-${feedId}`
  return (
    <section className="x-day x-grid" aria-labelledby={heading}>
      <div className="x-day-label x-search-feed">
        <h2 id={heading}>
          <FeedLink feedId={feedId} title={first.feedTitle} rhythm={rhythm} onOpen={onOpenFeed} />
        </h2>
        <span className="x-grey">{counted(matches.length, 'Feed Item')}</span>
        {narrowed ? null : (
          <Button className="x-more" onClick={onNarrow}>
            Search only here
          </Button>
        )}
      </div>
      <div className="x-rows x-plain">
        {matches.map((result) => {
          const item = {
            feedItemId: result.feedItemId,
            title: result.title.text,
            saved: result.saved,
            displayTime: result.displayTime,
          }
          return (
            <div key={result.feedItemId} className="x-row" data-saved={result.saved ? '' : undefined}>
              <span className="x-t">
                <TitleLink item={item} onOpen={onOpenItem}>
                  {marked(result.title)}
                </TitleLink>
                {result.snippet ? <span className="x-search-snippet">{marked(result.snippet)}</span> : null}
              </span>
              <span className="x-d">
                <SaveWord item={item} onSaved={(isSaved) => onSaved(result.feedItemId, isSaved)} />
                {dayAndTime(result.date, result.displayTime, today)}
              </span>
            </div>
          )
        })}
      </div>
    </section>
  )
}

function marked({ text, matches }: MarkedText): ReactNode {
  const parts: ReactNode[] = []
  let shown = 0
  for (const [start, end] of matches) {
    parts.push(
      text.slice(shown, start),
      <mark key={start} className="x-match">
        {text.slice(start, end)}
      </mark>,
    )
    shown = end
  }
  parts.push(text.slice(shown))
  return parts
}
