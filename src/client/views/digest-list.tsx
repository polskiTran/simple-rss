import { digestParamsOf, type DigestStart } from '../../shared/api.js'
import { fetchDigest } from '../api.js'
import { LoadFailure } from '../components/load-failure.js'
import { LoadingNote } from '../components/loading-note.js'
import { OlderItems } from '../components/older-items.js'
import { withSaved } from '../components/save-toggle.js'
import { usePagedResource, valueInView } from '../use-resource.js'
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
  const [state, { retry, set, loadMore, older }] = usePagedResource(
    digestParamsOf(start).toString(),
    (from, signal) => fetchDigest(from ? { from } : start, signal),
    (shown, page) => ({ ...shown, groups: [...shown.groups, ...page.groups], nextFrom: page.nextFrom }),
  )

  const setSaved = (feedItemId: number, saved: boolean) =>
    set((digest) => ({
      ...digest,
      groups: digest.groups.map((group) => ({ ...group, items: withSaved(group.items, feedItemId, saved) })),
    }))

  const digest = valueInView(state)
  if (!digest) {
    if (state.kind === 'unavailable' || state.kind === 'unreachable') {
      return (
        <LoadFailure
          subject="The digest"
          kind={state.kind}
          onRetry={() => {
            retry()
            onRetry()
          }}
        />
      )
    }
    return <LoadingNote>Loading the digest</LoadingNote>
  }

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
      <OlderItems nextCursor={digest.nextFrom} older={older} noun="items" onLoadOlder={loadMore} />
    </div>
  )
}
