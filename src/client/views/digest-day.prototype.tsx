// PROTOTYPE — throwaway. Text-first alternatives to the Digest's item boxes,
// switched with `?variant=` (or ← →) on the existing Digest route. Variant A is
// the current `DigestDay`; B–E replace it. Lives on the prototype branch only.
import { Button } from '@base-ui/react/button'
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { flushSync } from 'react-dom'
import type { DigestGroup, DigestItem } from '../../shared/api.js'
import { RoutedLink } from '../components/routed-link.js'
import { SaveToggle } from '../components/save-toggle.js'
import { counted, dayTitle, longDay, relativeDay, shortDay } from '../day-names.js'
import { feedPath, readerPath } from '../routing.js'
import './digest-day.prototype.css'
import './prototype-fonts/departure-mono.css'

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
/**
 * The roster's shared state: each Sources day registers its Feeds, and a Feed
 * picked for a day filters that day — from the inline roster on a phone or the
 * one under the calendar on desktop.
 */
interface RosterFeed {
  readonly feedId: number
  readonly title: string
  readonly count: number
}
const rosterDays = new Map<string, { readonly label: string; readonly feeds: readonly RosterFeed[] }>()
const rosterOnly = new Map<string, number | undefined>()
const rosterListeners = new Set<() => void>()
let rosterVersion = 0
function rosterChanged() {
  rosterVersion++
  for (const listener of rosterListeners) listener()
}
function useRoster() {
  return useSyncExternalStore(
    (listener) => {
      rosterListeners.add(listener)
      return () => rosterListeners.delete(listener)
    },
    () => rosterVersion,
  )
}
function pickRosterFeed(date: string, feedId: number) {
  rosterOnly.set(date, rosterOnly.get(date) === feedId ? undefined : feedId)
  rosterChanged()
}

function SourcesDay({ group, today, onOpenItem, onOpenFeed, onSaved }: DayProps) {
  const feeds = [...Map.groupBy(group.items, (item) => item.feedId).values()]
  useRoster()
  const only = rosterOnly.get(group.date)
  const setOnly = (feedId: number | undefined) => {
    rosterOnly.set(group.date, feedId)
    rosterChanged()
  }
  const signature = feeds.map((items) => `${items[0]?.feedId}:${items.length}`).join()
  // biome-ignore lint/correctness/useExhaustiveDependencies: PROTOTYPE — re-register only when the day's Feeds change.
  useEffect(() => {
    rosterDays.set(group.date, {
      label: dayTitle(group.date, today) === longDay(group.date) ? shortDay(group.date) : dayTitle(group.date, today),
      feeds: feeds.flatMap((items) =>
        items[0] ? [{ feedId: items[0].feedId, title: items[0].feedTitle, count: items.length }] : [],
      ),
    })
    rosterChanged()
    return () => {
      rosterDays.delete(group.date)
      rosterChanged()
    }
  }, [group.date, signature])
  return (
    <section className="p-src" data-date={group.date} aria-labelledby={`day-${group.date}`}>
      <DayHeading group={group} today={today} className="p-src-day" />
      {feeds.length > 1 ? (
        <p className="p-src-roster" data-filtering={only === undefined ? undefined : ''} aria-label="Feeds on this day">
          <span className="p-src-roster-lead">{counted(feeds.length, 'feed')}</span>
          {feeds.map((items) => {
            const first = items[0]
            if (!first) return null
            const pressed = only === first.feedId
            return (
              <button
                key={first.feedId}
                type="button"
                className="p-src-roster-feed"
                aria-pressed={pressed}
                onClick={() => setOnly(pressed ? undefined : first.feedId)}
              >
                {first.feedTitle}
                <span className="p-src-roster-count">{items.length}</span>
              </button>
            )
          })}
        </p>
      ) : null}
      {feeds
        .filter((items) => only === undefined || items[0]?.feedId === only)
        .map((items) => (
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
  const block = useRef<HTMLDivElement>(null)
  const first = items[0]
  if (!first) return null
  const foldable = items.length > 5
  const folded = foldable && !open
  // Folding again keeps the reader's place: the head (and its Show less) sticks
  // to the top while the open list scrolls past, and closing it scrolls back
  // to the block if its top has left the screen, so the next Feed is right below.
  const fold = () => {
    flushSync(() => setOpen(false))
    const top = block.current?.getBoundingClientRect().top ?? 0
    if (top < 0) block.current?.scrollIntoView({ block: 'start', behavior: 'instant' })
  }
  return (
    <div ref={block} className="p-src-block" data-open={foldable && open ? '' : undefined}>
      <div className="p-src-head">
        <FeedLink item={first} onOpenFeed={onOpenFeed} className="p-feed" />
        {items.length > 1 ? <span className="p-src-count">{counted(items.length, 'item')}</span> : null}
        {foldable && open ? (
          <Button className="p-src-more p-src-less" onClick={fold}>
            Show less
          </Button>
        ) : null}
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
        {folded ? (
          <li>
            <Button className="p-src-more" onClick={() => setOpen(true)}>
              Show {items.length - 3} more
            </Button>
          </li>
        ) : null}
      </ul>
    </div>
  )
}

const MONO_KEY = 'simple-rss.prototype-mono'

/** PROTOTYPE — grey text in Departure Mono (default) or Instrument Sans; `?mono=0` or the bar's toggle. */
export function useMonoMeta(): [boolean, () => void] {
  const read = () => {
    const param = new URLSearchParams(window.location.search).get('mono')
    if (param !== null) return param !== '0'
    try {
      return sessionStorage.getItem(MONO_KEY) !== '0'
    } catch {
      return true
    }
  }
  const [mono, setMono] = useState(read)
  useEffect(() => {
    document.documentElement.toggleAttribute('data-mono-meta', mono)
  }, [mono])
  const toggle = () => {
    const next = !mono
    const url = new URL(window.location.href)
    url.searchParams.set('mono', next ? '1' : '0')
    window.history.replaceState(window.history.state, '', url)
    try {
      sessionStorage.setItem(MONO_KEY, next ? '1' : '0')
    } catch {}
    setMono(next)
  }
  return [mono, toggle]
}

/**
 * Desktop: the roster of the day at the top of the screen, under the calendar,
 * one Feed a line so a long day runs down the column instead of across the list.
 */
export function SourcesRoster() {
  useRoster()
  const [date, setDate] = useState<string>()
  useEffect(() => {
    const spy = () => {
      const days = [...document.querySelectorAll<HTMLElement>('.p-src[data-date]')]
      // The last day whose heading has reached the top third of the screen.
      const line = window.innerHeight / 3
      const current = days.findLast((day) => day.getBoundingClientRect().top <= line) ?? days[0]
      setDate(current?.dataset.date)
    }
    spy()
    window.addEventListener('scroll', spy, { passive: true })
    const unlisten = () => window.removeEventListener('scroll', spy)
    rosterListeners.add(spy)
    return () => {
      unlisten()
      rosterListeners.delete(spy)
    }
  }, [])
  const day = date === undefined ? undefined : rosterDays.get(date)
  if (date === undefined || !day) return null
  const only = rosterOnly.get(date)
  return (
    <section className="p-roster" aria-labelledby="p-roster-heading">
      <h2 className="p-roster-heading" id="p-roster-heading">
        {day.label} <span className="p-count">{counted(day.feeds.length, 'feed')}</span>
      </h2>
      <ul className="p-roster-list" data-filtering={only === undefined ? undefined : ''}>
        {day.feeds.map((feed) => (
          <li key={feed.feedId}>
            <button
              type="button"
              className="p-roster-feed"
              aria-pressed={only === feed.feedId}
              onClick={() => pickRosterFeed(date, feed.feedId)}
            >
              <span className="p-roster-name">{feed.title}</span>
              <span className="p-roster-count">{feed.count}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
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
