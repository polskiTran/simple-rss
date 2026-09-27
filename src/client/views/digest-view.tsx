import { useState } from 'react'
import type { Digest } from '../../shared/api.js'
import { fetchDigest } from '../api.js'
import { Group } from '../components/group.js'
import { ItemBox } from '../components/item-box.js'
import { LoadFailure } from '../components/load-failure.js'
import { LoadingNote } from '../components/loading-note.js'
import { OlderItems, type OlderState } from '../components/older-items.js'
import { dayBefore, longDay, shortDay } from '../day-names.js'
import { useResource } from '../use-resource.js'

export interface DigestViewProps {
  onOpenItem(feedItemId: number): void
  onOpenFeed(feedId: number): void
}

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
  const [state, { retry, set }] = useResource((signal) => fetchDigest(undefined, signal), [])
  const [older, setOlder] = useState<OlderState>('idle')

  const loadOlder = (cursor: string) => {
    setOlder('loading')
    void fetchDigest(cursor)
      .then((page) => {
        setOlder('idle')
        set((digest) => withOlderPage(digest, page))
      })
      .catch(() => setOlder('failed'))
  }

  const setSaved = (feedItemId: number, saved: boolean) => {
    set((digest) => ({
      ...digest,
      groups: digest.groups.map((group) => ({
        ...group,
        items: group.items.map((item) => (item.feedItemId === feedItemId ? { ...item, saved } : item)),
      })),
    }))
  }

  const today = state.kind === 'loaded' ? state.value.today : undefined
  const head = (
    <header className="page-head">
      <h1 className="page-title">
        Digest
        {today ? <span className="page-title-companion">{shortDay(today)}</span> : null}
      </h1>
    </header>
  )

  if (state.kind === 'loading') {
    return (
      <div className="view">
        {head}
        <LoadingNote>Loading the digest</LoadingNote>
      </div>
    )
  }
  if (state.kind === 'unavailable' || state.kind === 'unreachable') {
    return (
      <div className="view">
        {head}
        <LoadFailure
          subject="The digest"
          kind={state.kind}
          onRetry={() => {
            setOlder('idle')
            retry()
          }}
        />
      </div>
    )
  }

  const digest = state.value
  return (
    <div className="view">
      {head}
      {digest.groups.length === 0 ? (
        <p className="note">Nothing yet. Subscribe to a feed in Feeds to start your digest.</p>
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
      <OlderItems nextCursor={digest.nextCursor} older={older} noun="items" onLoadOlder={loadOlder} />
    </div>
  )
}

/** Today and Yesterday are labelled relatively, so the day they name follows them. */
function relativeDay(date: string, today: string): boolean {
  return date === today || date === dayBefore(today)
}
