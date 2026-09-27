import { useState } from 'react'
import { digestParamsOf, type Digest, type DigestFilter } from '../../shared/api.js'
import { fetchDigest } from '../api.js'
import { Group } from '../components/group.js'
import { ItemBox } from '../components/item-box.js'
import { LoadFailure } from '../components/load-failure.js'
import { LoadingNote } from '../components/loading-note.js'
import { OlderItems, type OlderState } from '../components/older-items.js'
import { dayBefore, longDay } from '../day-names.js'
import { useResource, valueInView } from '../use-resource.js'

export interface DigestListProps {
  readonly filter: DigestFilter
  /** Said when nothing matches the filter. */
  readonly empty: string
  /** What else to load again when the list's Retry is pressed. */
  onRetry(): void
  onOpenItem(feedItemId: number): void
  onOpenFeed(feedId: number): void
}

/**
 * The Digest under one filter, a day to a group, paged older on request. A new
 * filter keeps the old list in view until its own first page answers.
 */
export function DigestList({ filter, empty, onRetry, onOpenItem, onOpenFeed }: DigestListProps) {
  const key = digestParamsOf(filter).toString()
  const [state, { retry, set }] = useResource(
    async (signal) => ({ key, digest: await fetchDigest(filter, undefined, signal) }),
    [key],
  )
  const [older, setOlder] = useState<{ key: string; state: OlderState }>({ key, state: 'idle' })
  const olderState = older.key === key ? older.state : 'idle'

  const loadOlder = (cursor: string) => {
    setOlder({ key, state: 'loading' })
    void fetchDigest(filter, cursor)
      .then((page) => {
        setOlder({ key, state: 'idle' })
        set((current) => (current.key === key ? { key, digest: withOlderPage(current.digest, page) } : current))
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
          <Group
            key={group.date}
            id={`day-${group.date}`}
            title={group.label}
            count={group.count}
            aside={relativeDay(group.date, digest.today) ? longDay(group.date) : undefined}
          >
            <div className="item-list">
              {group.items.map((item) => (
                <ItemBox
                  key={item.feedItemId}
                  feedItemId={item.feedItemId}
                  title={item.title}
                  saved={item.saved}
                  feed={{ feedId: item.feedId, title: item.feedTitle, onOpen: onOpenFeed }}
                  when={{ label: item.displayTime, dateTime: item.publishedAt ?? item.firstSeenAt }}
                  onOpen={onOpenItem}
                  onSaved={(saved) => setSaved(item.feedItemId, saved)}
                />
              ))}
            </div>
          </Group>
        ))
      )}
      <OlderItems nextCursor={digest.nextCursor} older={olderState} noun="items" onLoadOlder={loadOlder} />
    </div>
  )
}

/** A page may continue the last day shown; its first group then joins that one. */
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

/** Today and Yesterday are labelled relatively, so the day they name follows them. */
function relativeDay(date: string, today: string): boolean {
  return date === today || date === dayBefore(today)
}
