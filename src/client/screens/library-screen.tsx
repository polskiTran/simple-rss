import { type ReactNode, useState } from 'react'
import { z } from 'zod'
import type { DateKey, LibraryItem } from '../../shared/api.js'
import { useScreenTitle } from '../arrival.js'
import { fetchLibrary } from '../api.js'
import { counted, monthName, relativeDay, shortDate } from '../day-names.js'
import { useKept } from '../routing.js'
import { usePagedResource, valueInView } from '../use-resource.js'
import {
  FeedLink,
  LedgerRow,
  LoadFailure,
  OlderDays,
  Options,
  SaveWord,
  TitleLink,
  useRhythmOf,
} from '../components/ledger.js'

const ORDERS = [
  { value: 'newest', label: 'Newest saved' },
  { value: 'oldest', label: 'Oldest saved' },
  { value: 'feed', label: 'By Feed' },
] as const
const orderSchema = z.enum(['newest', 'oldest', 'feed'])
type Order = z.infer<typeof orderSchema>

interface LibraryScreenProps {
  onOpenItem(feedItemId: number): void
  onOpenFeed(feedId: number): void
}

export function LibraryScreen({ onOpenItem, onOpenFeed }: LibraryScreenProps) {
  useScreenTitle('Library')
  const [kept, keepOrder] = useKept('order', orderSchema)
  const order: Order = kept ?? 'newest'
  const fetchOrder = order === 'feed' ? 'newest' : order
  const [state, { retry, loadMore, older }] = usePagedResource(
    fetchOrder,
    (cursor: string | undefined, signal) => fetchLibrary(fetchOrder, cursor, signal),
    (shown, page) => ({ ...page, items: [...shown.items, ...page.items] }),
  )
  const [unsaved, setUnsaved] = useState<ReadonlySet<number>>(new Set())
  const rhythmOf = useRhythmOf()
  const library = valueInView(state)

  const mark = (feedItemId: number, saved: boolean) =>
    setUnsaved((current) => {
      const next = new Set(current)
      if (saved) next.delete(feedItemId)
      else next.add(feedItemId)
      return next
    })

  const feedName = (item: LibraryItem) =>
    item.subscribed ? (
      <FeedLink feedId={item.feedId} title={item.feedTitle} rhythm={rhythmOf(item.feedId)} onOpen={onOpenFeed} />
    ) : (
      <span className="x-grey" dir="auto" title="No longer subscribed">
        {item.feedTitle}
      </span>
    )

  const byFeed = order === 'feed'
  const groups = library
    ? byFeed
      ? [...Map.groupBy(library.items, (item) => item.feedId)].map(([feedId, items]) => ({
          key: `feed-${feedId}`,
          label: items[0] ? feedName(items[0]) : null,
          items,
        }))
      : [...Map.groupBy(library.items, (item) => item.savedDate.slice(0, 7))].map(([month, items]) => ({
          key: `month-${month}`,
          label: monthName(month, library.today),
          items,
        }))
    : []

  return (
    <div className="x-library">
      <header className="x-ledger">
        <LedgerRow label={<h1 className="visually-hidden">Library</h1>}>
          {library ? (
            library.total === 0 ? (
              'Nothing saved yet. Save a Feed Item from the Digest, a Feed or the Reader View.'
            ) : (
              counted(library.total - unsaved.size, 'saved Feed Item')
            )
          ) : state.kind === 'unavailable' || state.kind === 'unreachable' ? (
            <LoadFailure subject="The Library" kind={state.kind} onRetry={retry} />
          ) : (
            <span className="x-grey">Loading the Library</span>
          )}
        </LedgerRow>
        <LedgerRow label="Order">
          <Options
            label="Order"
            options={ORDERS}
            value={order}
            onChange={(next) => {
              keepOrder(next === 'newest' ? undefined : next)
              if ((next === 'feed' ? 'newest' : next) !== fetchOrder) setUnsaved(new Set())
            }}
          />
        </LedgerRow>
      </header>

      {library ? (
        <div className={byFeed ? 'x-plain' : undefined} aria-busy={state.kind === 'loading'}>
          {groups.map((group) => (
            <section key={group.key} className="x-day x-grid" aria-labelledby={group.key}>
              <h2 className="x-day-label" id={group.key}>
                {group.label}
              </h2>
              <div className="x-rows">
                {group.items.map((item) => (
                  <LibraryRow
                    key={item.feedItemId}
                    item={item}
                    today={library.today}
                    saved={!unsaved.has(item.feedItemId)}
                    feed={byFeed ? undefined : feedName(item)}
                    onOpen={onOpenItem}
                    onSaved={(saved) => mark(item.feedItemId, saved)}
                  />
                ))}
              </div>
            </section>
          ))}
          <OlderDays nextFrom={library.nextCursor} older={older} noun="saves" onMore={loadMore} />
        </div>
      ) : null}

      {library && library.total > 0 ? (
        <div className="x-legend x-grid" data-plain={byFeed ? '' : undefined} aria-hidden="true">
          <span className="x-c-label">{byFeed ? 'Feed' : 'Month'}</span>
          <span className="x-legend-title">Title</span>
          {byFeed ? null : <span className="x-legend-feed">Feed</span>}
          <span className="x-legend-time">Saved</span>
        </div>
      ) : null}
    </div>
  )
}

function LibraryRow({
  item,
  today,
  saved,
  feed,
  onOpen,
  onSaved,
}: {
  readonly item: LibraryItem
  readonly today: DateKey
  readonly saved: boolean
  readonly feed: ReactNode | undefined
  onOpen(feedItemId: number): void
  onSaved(saved: boolean): void
}) {
  const listed = { feedItemId: item.feedItemId, title: item.title, saved, displayTime: null }
  return (
    <div className="x-row" data-unsaved={saved ? undefined : ''}>
      <span className="x-t">
        <TitleLink item={listed} onOpen={onOpen} />
      </span>
      {feed === undefined ? null : <span className="x-f">{feed}</span>}
      <span className="x-d">
        <SaveWord item={listed} onSaved={onSaved} />
        {relativeDay(item.savedDate, today) ?? shortDate(item.savedDate, today)}
      </span>
    </div>
  )
}
