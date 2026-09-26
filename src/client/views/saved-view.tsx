import { Button } from '@base-ui/react/button'
import { useState } from 'react'
import type { LibraryItem } from '../../shared/api.js'
import { fetchLibrary, saveToLibrary } from '../api.js'
import { ItemBox } from '../components/item-box.js'
import { LoadFailure } from '../components/load-failure.js'
import { LoadingNote } from '../components/loading-note.js'
import { OlderItems, type OlderState } from '../components/older-items.js'
import { useResource } from '../use-resource.js'

export interface SavedViewProps {
  onOpenItem(feedItemId: number): void
  onOpenFeed(feedId: number): void
}

export function SavedView({ onOpenItem, onOpenFeed }: SavedViewProps) {
  const [state, { retry, set }] = useResource((signal) => fetchLibrary(undefined, signal), [])
  const [older, setOlder] = useState<OlderState>('idle')
  // Unsaved here but kept in place as an undo line until the Library is read again.
  const [unsaved, setUnsaved] = useState<ReadonlySet<number>>(new Set())

  const loadOlder = (cursor: string) => {
    setOlder('loading')
    void fetchLibrary(cursor)
      .then((page) => {
        setOlder('idle')
        set((library) => ({ items: [...library.items, ...page.items], nextCursor: page.nextCursor }))
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

  const head = (
    <header className="page-head">
      <h1 className="page-title">Saved</h1>
    </header>
  )

  if (state.kind === 'loading') {
    return (
      <div className="view">
        {head}
        <LoadingNote>Loading your saves</LoadingNote>
      </div>
    )
  }
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

  const library = state.value
  return (
    <div className="view">
      {head}
      {library.items.length === 0 ? (
        <p className="note">Nothing saved yet. Save an item from the digest or a feed to keep it here.</p>
      ) : (
        <div className="item-list">
          {library.items.map((item) =>
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
                  label: item.subscribed ? item.displayDate : `${item.displayDate} · No longer subscribed`,
                  dateTime: item.publishedAt ?? item.firstSeenAt,
                }}
                onOpen={onOpenItem}
                onSaved={(saved) => mark(item.feedItemId, saved)}
              />
            ),
          )}
        </div>
      )}
      <OlderItems nextCursor={library.nextCursor} older={older} noun="saves" onLoadOlder={loadOlder} />
    </div>
  )
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
