import { useEffect, useLayoutEffect, useRef } from 'react'
import { dateKeySchema, digestParamsOf, type DigestStart } from '../../shared/api.js'
import { fetchDigest } from '../api.js'
import { LoadFailure } from '../components/load-failure.js'
import { LoadingNote } from '../components/loading-note.js'
import { OlderItems } from '../components/older-items.js'
import { withSaved } from '../components/save-toggle.js'
import { playArrivals, playDayChange } from '../motion.js'
import { useKept } from '../routing.js'
import { usePagedResource, valueInView } from '../use-resource.js'
import { DigestDay } from './digest-day.js'

interface DigestListProps {
  readonly start: DigestStart
  readonly empty: string
  onRetry(): void
  onOpenItem(feedItemId: number): void
  onOpenFeed(feedId: number): void
}

export function DigestList({ start, empty, onRetry, onOpenItem, onOpenFeed }: DigestListProps) {
  const [through, keepThrough] = useKept('through', dateKeySchema)
  const [state, { retry, set, loadMore, older }] = usePagedResource(
    digestParamsOf(start).toString(),
    (from, signal) => fetchDigest(from ? { from } : { ...start, through }, signal),
    (shown, page) => ({ ...shown, groups: [...shown.groups, ...page.groups], nextFrom: page.nextFrom }),
  )
  const oldestShown = state.kind === 'loaded' ? state.value.groups.at(-1)?.date : undefined
  useEffect(() => {
    if (oldestShown) keepThrough(oldestShown)
  }, [oldestShown, keepThrough])

  const setSaved = (feedItemId: number, saved: boolean) =>
    set((digest) => ({
      ...digest,
      groups: digest.groups.map((group) => ({ ...group, items: withSaved(group.items, feedItemId, saved) })),
    }))

  const digest = valueInView(state)
  const days = useRef<HTMLDivElement>(null)
  const shownDays = useRef<{ first: string; count: number }>(undefined)
  const firstDay = digest?.groups[0]?.date
  const dayCount = digest?.groups.length ?? 0
  useLayoutEffect(() => {
    const before = shownDays.current
    shownDays.current = firstDay === undefined ? undefined : { first: firstDay, count: dayCount }
    if (!before || !days.current || firstDay === undefined) return
    if (firstDay !== before.first) playDayChange(days.current, firstDay < before.first ? 'older' : 'newer')
    else if (dayCount > before.count)
      playArrivals([...days.current.querySelectorAll(':scope > .digest-day')].slice(before.count))
  }, [firstDay, dayCount])

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
    <div ref={days} aria-busy={state.kind === 'loading'}>
      {digest.groups.length === 0 ? (
        <p className="note digest-empty">{empty}</p>
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
