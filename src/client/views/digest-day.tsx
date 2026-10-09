import { Button } from '@base-ui/react/button'
import { Toggle } from '@base-ui/react/toggle'
import { ToggleGroup } from '@base-ui/react/toggle-group'
import { useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import type { DigestGroup, DigestItem, DigestReturn } from '../../shared/api.js'
import { CadenceStrip } from '../components/cadence-strip.js'
import { Icon } from '../components/icon.js'
import { Group } from '../components/group.js'
import { ItemBox } from '../components/item-box.js'
import { RoutedLink } from '../components/routed-link.js'
import { SaveToggle } from '../components/save-toggle.js'
import { counted, dayTitle, longDay, relativeDay } from '../day-names.js'
import { feedPath, readerPath } from '../routing.js'

/** A Feed with more items than this in one day is folded to its newest `FOLDED_ITEMS`. */
const FOLD_OVER = 5
const FOLDED_ITEMS = 3

interface DigestDayProps {
  readonly group: DigestGroup
  readonly today: string
  onOpenItem(feedItemId: number): void
  onOpenFeed(feedId: number): void
  onSaved(feedItemId: number, saved: boolean): void
}

/** One Feed's items on one day, newest first. */
interface FeedDay {
  readonly feedId: number
  readonly title: string
  readonly items: readonly [DigestItem, ...DigestItem[]]
  readonly quiet: DigestReturn | undefined
}

/**
 * One day of the Digest: a box for each Feed that published, the most recent
 * first, under the day's Feeds as chips — pressing one shows that Feed alone.
 */
export function DigestDay({ group, today, onOpenItem, onOpenFeed, onSaved }: DigestDayProps) {
  const [only, setOnly] = useState<number>()
  const feeds = feedDaysOf(group)
  const title = dayTitle(group.date, today)
  const relative = relativeDay(group.date, today) !== undefined
  return (
    <Group
      id={`day-${group.date}`}
      title={title}
      count={group.items.length}
      aside={relative ? longDay(group.date) : undefined}
    >
      {feeds.length > 1 ? (
        <ToggleGroup
          className="day-feeds"
          aria-label={`Feeds on ${relative ? longDay(group.date) : title}`}
          value={only === undefined ? [] : [String(only)]}
          onValueChange={([chosen]) => setOnly(chosen === undefined ? undefined : Number(chosen))}
        >
          <span className="note">{counted(feeds.length, 'feed')}</span>
          {feeds.map((feed) => (
            <Toggle key={feed.feedId} className="chip" value={String(feed.feedId)}>
              {feed.title} <span className="chip-count">{feed.items.length}</span>
            </Toggle>
          ))}
        </ToggleGroup>
      ) : null}
      <div className="item-list day-items">
        {feeds
          .filter((feed) => only === undefined || feed.feedId === only)
          .map((feed) => (
            <FeedDayBox
              key={feed.feedId}
              feed={feed}
              onOpenItem={onOpenItem}
              onOpenFeed={onOpenFeed}
              onSaved={onSaved}
            />
          ))}
      </div>
    </Group>
  )
}

function feedDaysOf(group: DigestGroup): FeedDay[] {
  return [...Map.groupBy(group.items, (item) => item.feedId).values()].flatMap(([first, ...rest]) =>
    first
      ? [
          {
            feedId: first.feedId,
            title: first.feedTitle,
            items: [first, ...rest] as const,
            quiet: group.returns.find(({ feedId }) => feedId === first.feedId),
          },
        ]
      : [],
  )
}

/**
 * A lone item is the ordinary item box. More share one box under the Feed's
 * name, each title opening its own item — on a phone, where the Digest has no
 * save squares, a saved title is marked after its time; past `FOLD_OVER` the box opens folded,
 * and folds again on Show less — scrolled back to its head if that has left the
 * screen, so the reader stays at the box they closed.
 */
function FeedDayBox({
  feed,
  onOpenItem,
  onOpenFeed,
  onSaved,
}: Omit<DigestDayProps, 'group' | 'today'> & { feed: FeedDay }) {
  const [unfolded, setUnfolded] = useState(false)
  const box = useRef<HTMLElement>(null)
  const [newest] = feed.items
  const note = feed.quiet ? <QuietSpell spell={feed.quiet} title={feed.title} /> : null

  if (feed.items.length === 1) {
    return (
      <ItemBox
        feedItemId={newest.feedItemId}
        title={newest.title}
        saved={newest.saved}
        feed={{ feedId: feed.feedId, title: feed.title, onOpen: onOpenFeed }}
        when={{ label: newest.displayTime, dateTime: newest.publishedAt ?? newest.firstSeenAt }}
        note={note}
        onOpen={onOpenItem}
        onSaved={(saved) => onSaved(newest.feedItemId, saved)}
      />
    )
  }

  const foldable = feed.items.length > FOLD_OVER
  const folded = foldable && !unfolded
  const toggleFold = () => {
    flushSync(() => setUnfolded(!unfolded))
    if (unfolded && (box.current?.getBoundingClientRect().top ?? 0) < 0)
      box.current?.scrollIntoView({ behavior: 'instant' })
  }
  const oldest = feed.items.at(-1) ?? newest
  return (
    <article ref={box} className="item feed-day">
      <div className="item-meta">
        <RoutedLink className="item-feed" href={feedPath(feed.feedId)} onNavigate={() => onOpenFeed(feed.feedId)}>
          {feed.title}
        </RoutedLink>
        <span className="item-when">{counted(feed.items.length, 'item')}</span>
        <span className="item-when">
          {oldest.displayTime}–{newest.displayTime}
        </span>
        {note}
      </div>
      <div className="item-body">
        <ul className="feed-day-items">
          {(folded ? feed.items.slice(0, FOLDED_ITEMS) : feed.items).map((item) => (
            <li key={item.feedItemId} className="feed-day-item">
              <h3 className="feed-day-title">
                <RoutedLink href={readerPath(item.feedItemId)} onNavigate={() => onOpenItem(item.feedItemId)}>
                  {item.title}
                </RoutedLink>
              </h3>
              <time className="item-when" dateTime={item.publishedAt ?? item.firstSeenAt}>
                {item.displayTime}
              </time>
              {item.saved ? (
                <span className="feed-day-saved" role="img" aria-label="Saved">
                  <Icon name="bookmark" filled />
                </span>
              ) : null}
              <SaveToggle
                feedItemId={item.feedItemId}
                title={item.title}
                saved={item.saved}
                onSaved={(saved) => onSaved(item.feedItemId, saved)}
              />
            </li>
          ))}
        </ul>
        {foldable ? (
          <Button className="button button-small" aria-expanded={unfolded} onClick={toggleFold}>
            {folded ? `Show ${feed.items.length - FOLDED_ITEMS} more` : 'Show less'}
          </Button>
        ) : null}
      </div>
    </article>
  )
}

/** A Feed back after a Quiet Spell: its Cadence strip, then how long it was away. */
function QuietSpell({ spell, title }: { spell: DigestReturn; title: string }) {
  const span = spell.quietDays < 60 ? `${spell.quietDays} days` : `${Math.round(spell.quietDays / 30)} months`
  return (
    <span className="quiet-spell">
      <span aria-hidden="true">
        <CadenceStrip counts={spell.cadence} title={title} />
      </span>
      First item in {span}
    </span>
  )
}
