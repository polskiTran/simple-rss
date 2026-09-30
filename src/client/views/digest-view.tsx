import { Button } from '@base-ui/react/button'
import { useRef } from 'react'
import { useScreenTitle } from '../arrival.js'
import type { DigestCalendar, DigestFilter } from '../../shared/api.js'
import { fetchDigestCalendar } from '../api.js'
import { Icon } from '../components/icon.js'
import { shortDay } from '../day-names.js'
import { useResource, valueInView } from '../use-resource.js'
import { AddFeedDialog } from './add-feed-dialog.js'
import { DigestMonth } from './digest-month.js'
import { DigestList } from './digest-list.js'

export interface DigestViewProps {
  readonly filter: DigestFilter
  onFilter(filter: DigestFilter): void
  onOpenItem(feedItemId: number): void
  onOpenFeed(feedId: number): void
}

/**
 * The Digest: one list, newest day first, that starts today or from a day
 * picked on the calendar — a month of the whole Digest beside the list on a
 * wide screen, the platform's date picker on a phone. With no Subscriptions it
 * offers only the way to the first; until the calendar answers, the Digest is
 * drawn as begun.
 */
export function DigestView({ filter, onFilter, onOpenItem, onOpenFeed }: DigestViewProps) {
  useScreenTitle('Digest')
  const [calendar, { retry: retryCalendar }] = useResource(fetchDigestCalendar, [])
  const shown = valueInView(calendar)
  const firstRun = shown?.subscriptions === 0
  const stream = useRef<HTMLDivElement>(null)

  const readFrom = (from: string | undefined) => {
    onFilter({ from: from === shown?.today ? undefined : from })
    // Picked below the fold, the day starts the list back at its top.
    if ((stream.current?.getBoundingClientRect().top ?? 0) < 0) window.scrollTo(0, 0)
  }

  return (
    <div className="view">
      <header className="page-head digest-head">
        <h1 className="page-title">
          Digest
          {shown ? <span className="page-title-companion">{shortDay(shown.today)}</span> : null}
        </h1>
        {shown && !firstRun ? <DayPicker calendar={shown} from={filter.from} onFrom={readFrom} /> : null}
      </header>

      {firstRun ? (
        <div className="first-run">
          <p className="note">Nothing yet. Subscribe to a feed to start your digest.</p>
          <AddFeedDialog onSubscribed={retryCalendar} onImported={retryCalendar} />
        </div>
      ) : (
        <div className="with-aside">
          <div ref={stream}>
            {filter.from ? (
              <div className="newer">
                <Button className="button" onClick={() => readFrom(undefined)}>
                  Back to today
                </Button>
              </div>
            ) : null}
            <DigestList
              filter={filter}
              onRetry={retryCalendar}
              empty={
                filter.from ? 'Nothing on or before this day.' : 'Nothing yet. Items arrive here as your feeds publish.'
              }
              onOpenItem={onOpenItem}
              onOpenFeed={onOpenFeed}
            />
          </div>
          {shown ? <DigestMonth calendar={shown} selected={filter.from ?? shown.today} onPick={readFrom} /> : null}
        </div>
      )}
    </div>
  )
}

/**
 * A phone's way to a day, where the month has no room beside the list: the
 * platform's own date picker, laid invisibly over a calendar button.
 */
function DayPicker({
  calendar,
  from,
  onFrom,
}: {
  calendar: DigestCalendar
  from: string | undefined
  onFrom(day: string): void
}) {
  return (
    <label className="button button-icon day-picker">
      <Icon name="calendar" />
      <input
        type="date"
        aria-label="Start from a day"
        min={calendar.days[0]?.date}
        max={calendar.today}
        value={from ?? calendar.today}
        onChange={(event) => {
          if (event.target.value) onFrom(event.target.value)
        }}
      />
    </label>
  )
}
