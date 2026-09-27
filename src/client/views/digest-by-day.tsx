import { useState } from 'react'
import type { DigestCalendar } from '../../shared/api.js'
import { fetchDigestDay } from '../api.js'
import { cadenceGrid, counted } from '../cadence.js'
import { CadenceGrid } from '../components/cadence-grid.js'
import { FeedFilter } from '../components/feed-filter.js'
import { LoadFailure } from '../components/load-failure.js'
import { LoadingNote } from '../components/loading-note.js'
import { Row } from '../components/row.js'
import { longDay } from '../day-names.js'
import { useResource, valueInView, type Resource } from '../use-resource.js'
import { DigestList } from './digest-list.js'

export interface DigestByDayProps {
  /** Undefined until the calendar names today. */
  readonly day: string | undefined
  readonly calendar: Resource<DigestCalendar>
  onRetryCalendar(): void
  onDay(day: string): void
  onOpenItem(feedItemId: number): void
  onOpenFeed(feedId: number): void
}

const NONE_TICKED: ReadonlySet<number> = new Set()

/**
 * One day of the Digest under its 26 weeks, narrowed by the Feeds ticked beside it.
 * Stepping to another day keeps the one on show — its counts, items and Feeds —
 * until the next day answers, so the screen changes once rather than emptying first.
 */
export function DigestByDay({ day, calendar, onRetryCalendar, ...rest }: DigestByDayProps) {
  const shown = valueInView(calendar)
  if (day === undefined) {
    return calendar.kind === 'unavailable' || calendar.kind === 'unreachable' ? (
      <LoadFailure subject="The digest" kind={calendar.kind} onRetry={onRetryCalendar} />
    ) : (
      <LoadingNote>Loading the digest</LoadingNote>
    )
  }
  return <Day day={day} calendar={shown} onRetryCalendar={onRetryCalendar} {...rest} />
}

function Day({
  day,
  calendar,
  onRetryCalendar,
  onDay,
  onOpenItem,
  onOpenFeed,
}: Omit<DigestByDayProps, 'day' | 'calendar'> & {
  day: string
  calendar: DigestCalendar | undefined
}) {
  const [feeds] = useResource((signal) => fetchDigestDay(day, signal), [day])
  // Ticked Feeds belong to the day they were ticked on; stepping away leaves them behind.
  const [tickedOn, setTickedOn] = useState<{ day: string; feeds: ReadonlySet<number> }>({ day, feeds: new Set() })
  const ticked = tickedOn.day === day ? tickedOn.feeds : NONE_TICKED
  const shownFeeds = valueInView(feeds)
  const dayFeeds = shownFeeds?.feeds ?? []
  const grid = calendar ? cadenceGrid(calendar.days) : undefined

  return (
    <>
      <div className="digest-calendar">
        {grid ? <CadenceGrid grid={grid} title="your digest" selected={day} onShowDay={onDay} /> : <div />}
        <dl className="rows day-facts">
          <Row label="Day" value={calendar ? dayOfDigest(day, calendar.today) : longDay(day)} />
          {shownFeeds ? (
            <>
              <Row label="Items" value={dayFeeds.reduce((sum, feed) => sum + feed.count, 0).toLocaleString('en-GB')} />
              <Row label="Feeds" value={dayFeeds.length.toLocaleString('en-GB')} />
            </>
          ) : null}
          {grid ? (
            <>
              <Row label="Last 26 weeks" value={counted(grid.stats.total, 'item')} />
              <Row label="Busiest weekday" value={grid.stats.busiestWeekday ?? 'None yet'} />
            </>
          ) : null}
        </dl>
      </div>
      <div className="with-aside">
        <DigestList
          filter={{ day, feeds: [...ticked] }}
          onRetry={onRetryCalendar}
          empty="Nothing landed on this day."
          onOpenItem={onOpenItem}
          onOpenFeed={onOpenFeed}
        />
        {dayFeeds.length > 1 ? (
          <FeedFilter
            id="day-feeds"
            title="Feeds that day"
            feeds={dayFeeds}
            shown={ticked}
            onChange={(chosen) => setTickedOn({ day, feeds: chosen })}
          />
        ) : null}
      </div>
    </>
  )
}

/** `Tuesday 1 September`, with the year once it is not this one. */
function dayOfDigest(day: string, today: string): string {
  return day.slice(0, 4) === today.slice(0, 4) ? longDay(day) : `${longDay(day)} ${day.slice(0, 4)}`
}
