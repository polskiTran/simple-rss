import { Button } from '@base-ui/react/button'
import { useState } from 'react'
import { useScreenTitle } from '../arrival.js'
import type { LibraryItem, LibraryOrder } from '../../shared/api.js'
import { fetchLibrary, saveToLibrary } from '../api.js'
import { Choice } from '../components/choice.js'
import { Group } from '../components/group.js'
import { ItemBox } from '../components/item-box.js'
import { LoadFailure } from '../components/load-failure.js'
import { LoadingNote } from '../components/loading-note.js'
import { OlderItems, type OlderState } from '../components/older-items.js'
import { dayBefore, dayOfYear, monthName } from '../day-names.js'
import { useResource, valueInView } from '../use-resource.js'

export interface SavedViewProps {
  onOpenItem(feedItemId: number): void
  onOpenFeed(feedId: number): void
}

type Order = LibraryOrder | 'feed'

const ORDER_OPTIONS = [
  { value: 'newest', label: 'Newest saved' },
  { value: 'oldest', label: 'Oldest saved' },
  { value: 'feed', label: 'By feed' },
] as const

export function SavedView({ onOpenItem, onOpenFeed }: SavedViewProps) {
  useScreenTitle('Saved')
  const [order, setOrder] = useState<Order>('newest')
  // By feed groups the newest-first pages; only the two save orders ask anew.
  const fetchOrder = order === 'feed' ? 'newest' : order
  const [state, { retry, set }] = useResource((signal) => fetchLibrary(fetchOrder, undefined, signal), [fetchOrder])
  const [older, setOlder] = useState<OlderState>('idle')
  // Unsaved here but kept in place as an undo line until the Library is read again.
  const [unsaved, setUnsaved] = useState<ReadonlySet<number>>(new Set())

  const loadOlder = (cursor: string) => {
    setOlder('loading')
    void fetchLibrary(fetchOrder, cursor)
      .then((page) => {
        setOlder('idle')
        set((library) => ({ ...page, items: [...library.items, ...page.items] }))
      })
      .catch(() => setOlder('failed'))
  }

  const mark = (feedItemId: number, saved: boolean) =>
    setUnsaved((current) => {
      const next = new Set(current)
      if (saved) next.delete(feedItemId)
      else next.add(feedItemId)
      return next
    })

  const library = valueInView(state)
  const head = (
    <header className="page-head">
      <h1 className="page-title">
        Saved
        {library ? <span className="page-title-companion">{library.total - unsaved.size}</span> : null}
      </h1>
      {library && library.total > 0 ? (
        <div className="toolbar">
          <Choice
            label="Order"
            options={ORDER_OPTIONS}
            value={order}
            onChange={(next) => {
              setOrder(next)
              setOlder('idle')
              if ((next === 'feed' ? 'newest' : next) !== fetchOrder) setUnsaved(new Set())
            }}
          />
        </div>
      ) : null}
    </header>
  )

  if (state.kind === 'unavailable' || state.kind === 'unreachable') {
    return (
      <div className="view">
        {head}
        <LoadFailure
          subject="Your saves"
          kind={state.kind}
          onRetry={() => {
            setOlder('idle')
            retry()
          }}
        />
      </div>
    )
  }
  if (library === undefined) {
    return (
      <div className="view">
        {head}
        <LoadingNote>Loading your saves</LoadingNote>
      </div>
    )
  }

  const complete = library.nextCursor === null
  const groups =
    order === 'feed'
      ? [...Map.groupBy(library.items, (item) => item.feedId)].map(([feedId, items]) => ({
          id: `saved-feed-${feedId}`,
          title: items[0]?.feedTitle ?? '',
          items,
          // Any Feed may have saves further down the list.
          complete,
        }))
      : [...Map.groupBy(library.items, (item) => item.savedDate.slice(0, 7))].map(([month, items], index, all) => ({
          id: `saved-${month}`,
          title: monthName(`${month}-01`, library.today),
          items,
          // Pages run by save time, so a month is whole once a later one has begun.
          complete: complete || index < all.length - 1,
        }))

  return (
    <div className="view" aria-busy={state.kind === 'loading'}>
      {head}
      {library.items.length === 0 ? (
        <p className="note">Nothing saved yet. Save an item from the digest or a feed to keep it here.</p>
      ) : (
        groups.map((group) => (
          <Group
            key={group.id}
            id={group.id}
            title={group.title}
            count={group.complete ? group.items.length : undefined}
          >
            <div className="item-list">
              {group.items.map((item) =>
                unsaved.has(item.feedItemId) ? (
                  <UndoLine key={item.feedItemId} item={item} onResaved={() => mark(item.feedItemId, true)} />
                ) : (
                  <ItemBox
                    key={item.feedItemId}
                    feedItemId={item.feedItemId}
                    title={item.title}
                    saved
                    feed={{
                      feedId: item.feedId,
                      title: item.feedTitle,
                      onOpen: item.subscribed ? onOpenFeed : undefined,
                    }}
                    when={{
                      label: item.subscribed
                        ? savedLabel(item.savedDate, library.today)
                        : `${savedLabel(item.savedDate, library.today)} · No longer subscribed`,
                      dateTime: item.savedAt,
                    }}
                    onOpen={onOpenItem}
                    onSaved={(saved) => mark(item.feedItemId, saved)}
                  />
                ),
              )}
            </div>
          </Group>
        ))
      )}
      <OlderItems nextCursor={library.nextCursor} older={older} noun="saves" onLoadOlder={loadOlder} />
    </div>
  )
}

/** `Saved today`, `Saved yesterday`, then `Saved 27 August`. */
function savedLabel(savedDate: string, today: string): string {
  if (savedDate === today) return 'Saved today'
  if (savedDate === dayBefore(today)) return 'Saved yesterday'
  return `Saved ${dayOfYear(savedDate, today)}`
}

/** What an unsave leaves in the list: what happened, and the way back. */
function UndoLine({ item, onResaved }: { item: LibraryItem; onResaved: () => void }) {
  const [pending, setPending] = useState(false)
  const [failed, setFailed] = useState(false)

  async function undo() {
    if (pending) return
    setPending(true)
    setFailed(false)
    try {
      if ((await saveToLibrary(item.feedItemId)).saved) onResaved()
    } catch {
      setFailed(true)
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="undo-line" role="status">
      <span>
        {failed ? `“${item.title}” couldn’t be saved again. Try once more.` : `“${item.title}” is no longer saved.`}
      </span>
      <Button className="button button-outline button-small" focusableWhenDisabled disabled={pending} onClick={undo}>
        Undo
      </Button>
    </div>
  )
}
