import { Button } from '@base-ui/react/button'
import { useScreenTitle } from '../arrival.js'
import type { DigestCalendar } from '../../shared/api.js'
import { RHYTHM_LABELS, RHYTHMS } from '../../shared/rhythm.js'
import { fetchDigestCalendar } from '../api.js'
import { Choice } from '../components/choice.js'
import { Group } from '../components/group.js'
import { Icon } from '../components/icon.js'
import { dayAfter, dayBefore, longDay, recentDayName, shortDay } from '../day-names.js'
import { routedClick } from '../routed-link.js'
import { ALL_POSTS, digestPathOf, type DigestMode } from '../routing.js'
import { useResource, valueInView, type Resource } from '../use-resource.js'
import { AddFeedDialog } from './add-feed-dialog.js'
import { DigestByDay } from './digest-by-day.js'
import { DigestByFeed } from './digest-by-feed.js'
import { DigestList } from './digest-list.js'

export interface DigestViewProps {
  readonly mode: DigestMode
  onMode(mode: DigestMode): void
  onOpenItem(feedItemId: number): void
  onOpenFeed(feedId: number): void
}

const MODES = [
  { value: 'all', label: 'All items' },
  { value: 'day', label: 'By day' },
  { value: 'feed', label: 'By feed' },
] as const

const RHYTHM_CHOICES = [
  { value: 'everything', label: 'Everything' },
  ...RHYTHMS.map((rhythm) => ({ value: rhythm, label: RHYTHM_LABELS[rhythm] })),
] as const

/** Days the All items list names beside itself, today first. */
const RECENT_DAYS = 7

/**
 * The Digest read three ways. The calendar — the whole Digest's count for each
 * day — names today in the title, lists recent days beside All items, and draws
 * By day. Its counts are never narrowed: each day it names opens By day, which
 * shows all of that day. With no Subscriptions, All items offers only the way to
 * the first; until the calendar answers, the Digest is drawn as begun.
 */
export function DigestView({ mode, onMode, onOpenItem, onOpenFeed }: DigestViewProps) {
  useScreenTitle('Digest')
  const [calendar, { retry: retryCalendar }] = useResource(fetchDigestCalendar, [])
  const today = valueInView(calendar)?.today
  const firstRun = valueInView(calendar)?.subscriptions === 0
  const day = mode.by === 'day' ? (mode.day ?? today) : undefined
  const showDay = (date: string) => onMode({ by: 'day', day: date === today ? undefined : date })

  return (
    <div className="view">
      <header className="page-head">
        <h1 className="page-title">
          Digest
          {today ? <span className="page-title-companion">{shortDay(today)}</span> : null}
        </h1>
        <div className="toolbar digest-toolbar">
          <Choice
            label="Read the digest"
            options={MODES}
            value={mode.by}
            onChange={(by) => onMode(by === 'all' ? ALL_POSTS : by === 'day' ? { by, day: undefined } : { by })}
          />
          {mode.by === 'all' && !firstRun ? (
            <Choice
              label="Rhythm"
              className="toolbar-end rhythm-choice"
              options={RHYTHM_CHOICES}
              value={mode.rhythm ?? 'everything'}
              onChange={(chosen) => onMode({ by: 'all', rhythm: chosen === 'everything' ? undefined : chosen })}
            />
          ) : null}
          {day && today ? <DayStepper day={day} today={today} onDay={showDay} /> : null}
          {mode.by === 'feed' ? <p className="note toolbar-end">Ordered by most recent item</p> : null}
        </div>
      </header>

      {mode.by === 'all' && firstRun ? (
        <div className="first-run">
          <p className="note">Nothing yet. Subscribe to a feed to start your digest.</p>
          <AddFeedDialog onSubscribed={retryCalendar} onImported={retryCalendar} />
        </div>
      ) : null}
      {mode.by === 'all' && !firstRun ? (
        <div className="with-aside">
          <DigestList
            filter={{ rhythm: mode.rhythm }}
            onRetry={retryCalendar}
            empty={
              mode.rhythm
                ? `Nothing from ${RHYTHM_LABELS[mode.rhythm].toLowerCase()} feeds.`
                : 'Nothing yet. Items arrive here as your feeds publish.'
            }
            onOpenItem={onOpenItem}
            onOpenFeed={onOpenFeed}
          />
          <RecentDays calendar={calendar} onDay={showDay} />
        </div>
      ) : null}
      {mode.by === 'day' ? (
        <DigestByDay
          day={day}
          calendar={calendar}
          onRetryCalendar={retryCalendar}
          onDay={showDay}
          onOpenItem={onOpenItem}
          onOpenFeed={onOpenFeed}
        />
      ) : null}
      {mode.by === 'feed' ? <DigestByFeed onOpenItem={onOpenItem} onOpenFeed={onOpenFeed} /> : null}
    </div>
  )
}

/** Back a day, forward up to today, and straight back to today. */
function DayStepper({ day, today, onDay }: { day: string; today: string; onDay: (day: string) => void }) {
  const isToday = day === today
  return (
    <div className="toolbar-group toolbar-end day-stepper">
      <Button className="button button-icon" aria-label="Previous day" onClick={() => onDay(dayBefore(day))}>
        <Icon name="chevron-left" />
      </Button>
      <Button className="button wide-only" focusableWhenDisabled disabled={isToday} onClick={() => onDay(today)}>
        Today
      </Button>
      <span className="day-stepper-day">{longDay(day)}</span>
      <Button
        className="button button-icon"
        aria-label="Next day"
        focusableWhenDisabled
        disabled={isToday}
        onClick={() => onDay(dayAfter(day))}
      >
        <Icon name="chevron-right" />
      </Button>
    </div>
  )
}

/** The last week of days with their counts, each a way into that day. */
function RecentDays({ calendar, onDay }: { calendar: Resource<DigestCalendar>; onDay: (day: string) => void }) {
  const shown = valueInView(calendar)
  if (!shown) return null
  const days = shown.days.slice(-RECENT_DAYS).toReversed()
  return (
    <nav className="recent-days" aria-label="Days">
      <Group id="recent-days" title="Days" className="panel">
        <ul className="day-list">
          {days.map(({ date, count }) => (
            <li key={date}>
              <a
                className="day-row"
                href={digestPathOf({ by: 'day', day: date })}
                onClick={routedClick(() => onDay(date))}
              >
                <span className="day-row-name">{recentDayName(date, shown.today)}</span>
                <span className="day-row-count">{count.toLocaleString('en-GB')}</span>
              </a>
            </li>
          ))}
        </ul>
      </Group>
    </nav>
  )
}
