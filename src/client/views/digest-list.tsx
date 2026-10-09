import { useState } from 'react'
import { digestParamsOf, type DigestStart } from '../../shared/api.js'
import { fetchDigest } from '../api.js'
import { LoadFailure } from '../components/load-failure.js'
import { LoadingNote } from '../components/loading-note.js'
import { OlderItems, type OlderState } from '../components/older-items.js'
import { useResource, valueInView } from '../use-resource.js'
import { DigestDay } from './digest-day.js'

export interface DigestListProps {
  readonly start: DigestStart
  /** Said when the Digest has nothing from its start. */
  readonly empty: string
  /** What else to load again when the list's Retry is pressed. */
  onRetry(): void
  onOpenItem(feedItemId: number): void
  onOpenFeed(feedId: number): void
}

/**
 * The Digest from one day, or from today, a day to a group; Show more goes on
 * from the day the page names. A new start keeps the old list in view until
 * its own first page answers.
 */
export function DigestList({ start, empty, onRetry, onOpenItem, onOpenFeed }: DigestListProps) {
  const key = digestParamsOf(start).toString()
  const [state, { retry, set }] = useResource(
    async (signal) => ({ key, digest: await fetchDigest(start, signal) }),
    [key],
  )
  const [older, setOlder] = useState<{ key: string; state: OlderState }>({ key, state: 'idle' })
  const olderState = older.key === key ? older.state : 'idle'

  const loadOlder = (from: string) => {
    setOlder({ key, state: 'loading' })
    void fetchDigest({ from })
      .then((page) => {
        setOlder({ key, state: 'idle' })
        set((current) =>
          current.key === key
            ? {
                key,
                digest: {
                  ...current.digest,
                  groups: [...current.digest.groups, ...page.groups],
                  nextFrom: page.nextFrom,
                },
              }
            : current,
        )
      })
      .catch(() => setOlder({ key, state: 'failed' }))
  }

  const setSaved = (feedItemId: number, saved: boolean) => {
    set((current) => ({
      ...current,
      digest: {
        ...current.digest,
        groups: current.digest.groups.map((group) => ({
          ...group,
          items: group.items.map((item) => (item.feedItemId === feedItemId ? { ...item, saved } : item)),
        })),
      },
    }))
  }

  const shown = valueInView(state)
  if (!shown) {
    if (state.kind === 'unavailable' || state.kind === 'unreachable') {
      return (
        <LoadFailure
          subject="The digest"
          kind={state.kind}
          onRetry={() => {
            setOlder({ key, state: 'idle' })
            retry()
            onRetry()
          }}
        />
      )
    }
    return <LoadingNote>Loading the digest</LoadingNote>
  }

  const { digest } = shown
  return (
    <div aria-busy={state.kind === 'loading'}>
      {digest.groups.length === 0 ? (
        <p className="note">{empty}</p>
      ) : (
        digest.groups.map((group) => (
          <DigestDay
            key={group.date}
            group={group}
            today={digest.today}
            onOpenItem={onOpenItem}
            onOpenFeed={onOpenFeed}
            onSaved={setSaved}
          />
        ))
      )}
      <OlderItems nextCursor={digest.nextFrom} older={olderState} noun="items" onLoadOlder={loadOlder} />
    </div>
  )
}
