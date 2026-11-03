import { Button } from '@base-ui/react/button'
import { Toggle } from '@base-ui/react/toggle'
import { ToggleGroup } from '@base-ui/react/toggle-group'
import { useRef } from 'react'
import { flushSync } from 'react-dom'
import { z } from 'zod'
import type { DigestGroup, DigestItem, DigestReturn } from '../../shared/api.js'
import { Icon } from '../components/icon.js'
import { Group } from '../components/group.js'
import { FeedName } from '../components/item-box.js'
import { RoutedLink } from '../components/routed-link.js'
import { SaveToggle } from '../components/save-toggle.js'
import { counted, dayDistance, headingDay, longDay, namedDay, relativeDay } from '../day-names.js'
import { feedPath, readerPath, useKept } from '../routing.js'

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

interface FeedDay {
  readonly date: string
  readonly feedId: number
  readonly title: string
  readonly items: readonly [DigestItem, ...DigestItem[]]
  readonly quiet: DigestReturn | undefined
}

export function DigestDay({ group, today, onOpenItem, onOpenFeed, onSaved }: DigestDayProps) {
  const [only, keepOnly] = useKept(`only ${group.date}`, z.number())
  const feeds = feedDaysOf(group)
  const day = relativeDay(group.date, today) ? longDay(group.date) : namedDay(group.date, today)
  return (
    <Group
      id={`day-${group.date}`}
      className="digest-day"
      headingClassName="page-title"
      title={
        <>
          <span className="day-distance">{dayDistance(group.date, today)}</span> {headingDay(group.date, today)}{' '}
          <span className="day-count">{group.items.length.toLocaleString('en-GB')}</span>
        </>
      }
    >
      {feeds.length > 1 ? (
        <ToggleGroup
          className="day-feeds"
          aria-label={`Feeds on ${day}`}
          value={only === undefined ? [] : [String(only)]}
          onValueChange={([chosen]) => keepOnly(chosen === undefined ? undefined : Number(chosen))}
        >
          {feeds.map((feed) => (
            <Toggle key={feed.feedId} className="chip" value={String(feed.feedId)} title={feed.title}>
              <span className="chip-name">{feed.title}</span>{' '}
              <span className="chip-count">{feed.items.length.toLocaleString('en-GB')}</span>
            </Toggle>
          ))}
        </ToggleGroup>
      ) : null}
      <div className="item-list">
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
            date: group.date,
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
 * A Feed's day: who on one line, then every title across the box. The saved
 * highlight reads the toggle's own state, so it answers on the press. Past
 * `FOLD_OVER`, the control stays in the header, which sticks while unfolded, so
 * folding is where unfolding was however far down the list; unfolded is kept
 * on the history entry, so the box is still open on the way back.
 */
function FeedDayBox({
  feed,
  onOpenItem,
  onOpenFeed,
  onSaved,
}: Omit<DigestDayProps, 'group' | 'today'> & { feed: FeedDay }) {
  const [unfolded = false, keepUnfolded] = useKept(`unfolded ${feed.date} ${feed.feedId}`, z.boolean())
  const box = useRef<HTMLElement>(null)
  const foldable = feed.items.length > FOLD_OVER
  const folded = foldable && !unfolded
  const toggleFold = () => {
    flushSync(() => keepUnfolded(!unfolded))
    if (unfolded && (box.current?.getBoundingClientRect().top ?? 0) < 0) box.current?.scrollIntoView()
  }
  const quiet = feed.quiet ? <QuietSpell quietDays={feed.quiet.quietDays} /> : null
  return (
    <article ref={box} className="feed-day" data-unfolded={foldable && unfolded ? '' : undefined}>
      <header className="feed-day-head">
        <div className="feed-day-who">
          <RoutedLink className="item-feed" href={feedPath(feed.feedId)} onNavigate={() => onOpenFeed(feed.feedId)}>
            <FeedName title={feed.title} />
          </RoutedLink>
          {feed.items.length > 1 ? <span className="item-when">{counted(feed.items.length, 'item')}</span> : null}
          {foldable ? null : quiet}
        </div>
        {foldable ? (
          <Button className="feed-day-fold" aria-expanded={unfolded} onClick={toggleFold}>
            <span className="feed-day-fold-label">{folded ? 'Show all' : 'Show less'}</span>
            <Icon name={folded ? 'chevron-down' : 'chevron-up'} />
          </Button>
        ) : null}
        {foldable ? quiet : null}
      </header>
      <ul className="feed-day-items">
        {(folded ? feed.items.slice(0, FOLDED_ITEMS) : feed.items).map((item) => (
          <li key={item.feedItemId} className="feed-day-item">
            <h3 className="feed-day-title">
              <RoutedLink href={readerPath(item.feedItemId)} onNavigate={() => onOpenItem(item.feedItemId)}>
                {item.saved ? <span className="visually-hidden">Saved: </span> : null}
                <span className="item-text">{item.title}</span>
              </RoutedLink>
            </h3>
            <SaveToggle
              feedItemId={item.feedItemId}
              title={item.title}
              saved={item.saved}
              onSaved={(saved) => onSaved(item.feedItemId, saved)}
            />
          </li>
        ))}
      </ul>
    </article>
  )
}

function QuietSpell({ quietDays }: { quietDays: number }) {
  const span = quietDays < 60 ? `${quietDays} days` : `${Math.round(quietDays / 30)} months`
  return <span className="quiet-spell">First in {span}</span>
}
