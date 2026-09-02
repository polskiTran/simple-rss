import { Button } from '@base-ui/react/button'
import { useState } from 'react'
import type { Digest } from '../../shared/api.js'
import { fetchDigest } from '../api.js'
import { DailyBand } from '../components/daily-band.js'
import { FeedTitleLink } from '../components/feed-title-link.js'
import { ItemTitleLink } from '../components/item-title-link.js'
import { LoadingNote } from '../components/loading-note.js'
import { OlderItems, type OlderState } from '../components/older-items.js'
import { SaveToggle } from '../components/save-toggle.js'
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

  const tryAgain = () => {
    setOlder('idle')
    retry()
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

  if (state.kind === 'loading') {
    return <LoadingNote className="view measure empty-note">loading the digest</LoadingNote>
  }
  if (state.kind === 'unavailable' || state.kind === 'unreachable') {
    return (
      <div className="view measure">
        <p className="empty-note" role="status">
          {state.kind === 'unreachable'
            ? 'the digest is out of reach — check the connection, then try again'
            : 'the digest is unavailable — try again in a moment'}
        </p>
        <p className="digest-retry">
          <Button className="text-button" onClick={tryAgain}>
            try again
          </Button>
        </p>
      </div>
    )
  }

  const digest = state.value
  if (digest.groups.length === 0) {
    return <p className="view measure empty-note">nothing yet — subscribe to a Feed to start your digest</p>
  }

  const { today } = digest

  return (
    <div className="view measure digest-view digest-view-today">
      <DailyBand date={today.date} volume={today.volume} />
      {digest.groups.map((group) => (
        <section className="day-group" aria-labelledby={`day-${group.date}`} key={group.date}>
          <h2
            className={group.label === 'today' ? 'day-heading' : 'day-heading day-heading-past'}
            id={`day-${group.date}`}
          >
            {group.label}
            {group.label === 'today' ? (
              <span className="day-heading-count"> · {countLabel(digest.today.volume)}</span>
            ) : null}
          </h2>
          <div className="content-list">
            {group.items.map((item) => (
              <article className="content-item" key={item.feedItemId}>
                <h3 className="content-item-title">
                  <ItemTitleLink feedItemId={item.feedItemId} title={item.title} onOpen={onOpenItem} />
                </h3>
                <div className="content-meta">
                  <FeedTitleLink feedId={item.feedId} title={item.feedTitle} onOpen={onOpenFeed} />
                  <time dateTime={item.publishedAt ?? item.firstSeenAt}>{item.displayTime}</time>
                  <SaveToggle
                    feedItemId={item.feedItemId}
                    title={item.title}
                    saved={item.saved}
                    onSaved={(saved) => setSaved(item.feedItemId, saved)}
                  />
                </div>
              </article>
            ))}
          </div>
        </section>
      ))}
      <OlderItems nextCursor={digest.nextCursor} older={older} noun="items" onLoadOlder={loadOlder} />
    </div>
  )
}

function countLabel(count: number): string {
  return count === 1 ? '1 post' : `${count} posts`
}
