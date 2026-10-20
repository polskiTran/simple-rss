// PROTOTYPE — throwaway. Text-first alternatives to the Digest's item boxes,
// switched with `?variant=` (or ← →) on the existing Digest route. Variant A is
// the current `DigestDay`; B–E replace it. Lives on the prototype branch only.
import { Button } from '@base-ui/react/button'
import { useEffect, useState } from 'react'
import type { DigestGroup, DigestItem } from '../../shared/api.js'
import { RoutedLink } from '../components/routed-link.js'
import { SaveToggle } from '../components/save-toggle.js'
import { counted, dayTitle, longDay, relativeDay } from '../day-names.js'
import { feedPath, readerPath } from '../routing.js'
import './digest-day.prototype.css'

export const DIGEST_VARIANTS = [
  { key: 'A', name: 'Current boxes' },
  { key: 'B', name: 'Log' },
  { key: 'C', name: 'Hour rail' },
  { key: 'D', name: 'Sources' },
  { key: 'E', name: 'Columns' },
] as const
export type DigestVariant = (typeof DIGEST_VARIANTS)[number]['key']
export const DIGEST_VARIANT_KEYS = ['A', 'B', 'C', 'D', 'E'] as const satisfies readonly DigestVariant[]

interface DayProps {
  readonly group: DigestGroup
  readonly today: string
  onOpenItem(feedItemId: number): void
  onOpenFeed(feedId: number): void
  onSaved(feedItemId: number, saved: boolean): void
}

export function DigestDayPrototype({ variant, ...props }: DayProps & { variant: Exclude<DigestVariant, 'A'> }) {
  switch (variant) {
    case 'B':
      return <LogDay {...props} />
    case 'C':
      return <RailDay {...props} />
    case 'D':
      return <SourcesDay {...props} />
    case 'E':
      return <ColumnsDay {...props} />
  }
}

function DayHeading({ group, today, className }: { group: DigestGroup; today: string; className: string }) {
  const relative = relativeDay(group.date, today) !== undefined
  return (
    <h2 className={className} id={`day-${group.date}`}>
      {dayTitle(group.date, today)} <span className="p-count">{group.items.length}</span>
      {relative ? <span className="p-aside">{longDay(group.date)}</span> : null}
    </h2>
  )
}

function FeedLink({
  item,
  onOpenFeed,
  className,
}: {
  item: DigestItem
  onOpenFeed(id: number): void
  className: string
}) {
  return (
    <RoutedLink className={className} href={feedPath(item.feedId)} onNavigate={() => onOpenFeed(item.feedId)}>
      {item.feedTitle}
    </RoutedLink>
  )
}

function TitleLink({ item, onOpenItem }: { item: DigestItem; onOpenItem(id: number): void }) {
  return (
    <RoutedLink href={readerPath(item.feedItemId)} onNavigate={() => onOpenItem(item.feedItemId)}>
      {item.title}
    </RoutedLink>
  )
}

function Save({ item, onSaved }: { item: DigestItem; onSaved(id: number, saved: boolean): void }) {
  return (
    <SaveToggle
      feedItemId={item.feedItemId}
      title={item.title}
      saved={item.saved}
      onSaved={(saved) => onSaved(item.feedItemId, saved)}
    />
  )
}

/* ── B · Log ───────────────────────────────────────────────────────────────
 * One line per item, newest first, like a log: time · Feed · title. A Feed
 * repeated on the next line is left blank so runs read as one source. No rules:
 * rhythm comes from the fixed line height. j / k move a cursor, Enter opens. */
function LogDay({ group, today, onOpenItem, onOpenFeed, onSaved }: DayProps) {
  return (
    <section className="p-log" aria-labelledby={`day-${group.date}`}>
      <DayHeading group={group} today={today} className="p-log-day" />
      <ol className="p-log-lines">
        {group.items.map((item, index) => {
          const repeat = group.items[index - 1]?.feedId === item.feedId
          return (
            <li key={item.feedItemId} className="p-log-line" data-saved={item.saved ? '' : undefined}>
              <time className="p-log-time" dateTime={item.publishedAt ?? item.firstSeenAt}>
                {item.displayTime}
              </time>
              <span className="p-log-feed">
                {repeat ? null : <FeedLink item={item} onOpenFeed={onOpenFeed} className="p-feed" />}
              </span>
              <span className="p-log-title">
                <TitleLink item={item} onOpenItem={onOpenItem} />
              </span>
              <Save item={item} onSaved={onSaved} />
            </li>
          )
        })}
      </ol>
    </section>
  )
}

/** j / k cursor over Log lines, page-wide: Enter follows the line's title. */
export function useLogCursor(active: boolean) {
  useEffect(() => {
    if (!active) return
    let at = -1
    const onKey = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLElement && event.target.closest('input, textarea')) return
      const lines = [...document.querySelectorAll<HTMLElement>('.p-log-line')]
      if (event.key === 'j' || event.key === 'k') {
        lines[at]?.removeAttribute('data-cursor')
        at = Math.min(lines.length - 1, Math.max(0, at + (event.key === 'j' ? 1 : -1)))
        const line = lines[at]
        line?.setAttribute('data-cursor', '')
        line?.scrollIntoView({ block: 'nearest' })
      }
      if (event.key === 'Enter' && document.activeElement === document.body)
        lines[at]?.querySelector<HTMLAnchorElement>('.p-log-title a')?.click()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [active])
}

/* ── C · Hour rail ─────────────────────────────────────────────────────────
 * The day read as a transcript: items bucketed by hour, the hour held in a
 * left rail beside its run. Titles wrap (two lines at most) and carry their
 * Feed inline after them, so the eye reads title first, source second. */
function RailDay({ group, today, onOpenItem, onOpenFeed, onSaved }: DayProps) {
  const hours = [...Map.groupBy(group.items, (item) => item.displayTime.slice(0, 2)).entries()]
  return (
    <section className="p-rail" aria-labelledby={`day-${group.date}`}>
      <DayHeading group={group} today={today} className="p-rail-day" />
      {hours.map(([hour, items]) => (
        <div key={hour} className="p-rail-hour">
          <div className="p-rail-label">
            <span>{hour}:00</span>
          </div>
          <ul className="p-rail-items">
            {items.map((item) => (
              <li key={item.feedItemId} className="p-rail-item">
                <p className="p-rail-text">
                  <span className="p-rail-title">
                    <TitleLink item={item} onOpenItem={onOpenItem} />
                  </span>{' '}
                  <span className="p-rail-meta">
                    <FeedLink item={item} onOpenFeed={onOpenFeed} className="p-feed" />
                    <span className="p-rail-minute">{item.displayTime}</span>
                  </span>
                </p>
                <Save item={item} onSaved={onSaved} />
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  )
}

/* ── D · Sources ───────────────────────────────────────────────────────────
 * Grouped by Feed like today's shared box, without the box: the Feed name
 * hangs in a left column with its count, its titles run one per line beside
 * it with the time trailing. Whitespace, not edges, separates Feeds. */
function SourcesDay({ group, today, onOpenItem, onOpenFeed, onSaved }: DayProps) {
  const feeds = [...Map.groupBy(group.items, (item) => item.feedId).values()]
  return (
    <section className="p-src" aria-labelledby={`day-${group.date}`}>
      <DayHeading group={group} today={today} className="p-src-day" />
      {feeds.map((items) => (
        <SourceBlock
          key={items[0]?.feedId}
          items={items}
          onOpenItem={onOpenItem}
          onOpenFeed={onOpenFeed}
          onSaved={onSaved}
        />
      ))}
    </section>
  )
}

function SourceBlock({
  items,
  onOpenItem,
  onOpenFeed,
  onSaved,
}: Omit<DayProps, 'group' | 'today'> & { items: DigestItem[] }) {
  const [open, setOpen] = useState(false)
  const first = items[0]
  if (!first) return null
  const folded = items.length > 5 && !open
  return (
    <div className="p-src-block">
      <div className="p-src-head">
        <FeedLink item={first} onOpenFeed={onOpenFeed} className="p-feed" />
        {items.length > 1 ? <span className="p-src-count">{counted(items.length, 'item')}</span> : null}
      </div>
      <ul className="p-src-items">
        {(folded ? items.slice(0, 3) : items).map((item) => (
          <li key={item.feedItemId} className="p-src-line">
            <span className="p-src-title">
              <TitleLink item={item} onOpenItem={onOpenItem} />
            </span>
            <time className="p-src-time" dateTime={item.publishedAt ?? item.firstSeenAt}>
              {item.displayTime}
            </time>
            <Save item={item} onSaved={onSaved} />
          </li>
        ))}
        {items.length > 5 ? (
          <li>
            <Button className="p-src-more" onClick={() => setOpen(!open)}>
              {folded ? `Show ${items.length - 3} more` : 'Show less'}
            </Button>
          </li>
        ) : null}
      </ul>
    </div>
  )
}

/* ── E · Columns ───────────────────────────────────────────────────────────
 * Newspaper index: the day fills two columns row by row, so time still reads
 * left to right (one column on a phone). Each
 * entry is a small meta line — Feed, time — over a title of up to two lines.
 * Uses the page's width for density instead of making lines longer. */
function ColumnsDay({ group, today, onOpenItem, onOpenFeed, onSaved }: DayProps) {
  return (
    <section className="p-col" aria-labelledby={`day-${group.date}`}>
      <DayHeading group={group} today={today} className="p-col-day" />
      <ol className="p-col-list">
        {group.items.map((item) => (
          <li key={item.feedItemId} className="p-col-entry" data-saved={item.saved ? '' : undefined}>
            <div className="p-col-meta">
              <FeedLink item={item} onOpenFeed={onOpenFeed} className="p-feed" />
              <time dateTime={item.publishedAt ?? item.firstSeenAt}>{item.displayTime}</time>
            </div>
            <h3 className="p-col-title">
              <TitleLink item={item} onOpenItem={onOpenItem} />
            </h3>
            <Save item={item} onSaved={onSaved} />
          </li>
        ))}
      </ol>
    </section>
  )
}
