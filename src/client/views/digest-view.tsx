import { Button } from '@base-ui/react/button'
import { useRef } from 'react'
import { useScreenTitle } from '../arrival.js'
import { type DateKey, dateKeySchema, type DigestCalendar, type DigestStart } from '../../shared/api.js'
import { fetchDigestCalendar } from '../api.js'
import { Icon } from '../components/icon.js'
import { useResource, valueInView } from '../use-resource.js'
import { AddFeedDialog } from './add-feed-dialog.js'
import { DigestMonth } from './digest-month.js'
import { DigestList } from './digest-list.js'

interface DigestViewProps {
  readonly start: DigestStart
  onStart(start: DigestStart): void
  onOpenItem(feedItemId: number): void
  onOpenFeed(feedId: number): void
}

export function DigestView({ start, onStart, onOpenItem, onOpenFeed }: DigestViewProps) {
  useScreenTitle('Digest')
  const [calendar, { retry: retryCalendar }] = useResource('calendar', fetchDigestCalendar)
  const shown = valueInView(calendar)
  const firstRun = shown?.subscriptions === 0
  const stream = useRef<HTMLDivElement>(null)

  const readFrom = (from: DateKey | undefined) => {
    onStart({ from: from === shown?.today ? undefined : from })
    if ((stream.current?.getBoundingClientRect().top ?? 0) < 0) window.scrollTo({ top: 0 })
  }

  return (
    <div className="view">
      <header className={firstRun ? 'page-head' : 'page-head digest-head'}>
        <h1 className={firstRun ? 'page-title' : 'visually-hidden'}>Digest</h1>
        {shown && !firstRun ? (
          <div className="day-tools">
            {start.from ? (
              <Button className="button" onClick={() => readFrom(undefined)}>
                Today
              </Button>
            ) : null}
            <DayPicker calendar={shown} from={start.from} onFrom={readFrom} />
          </div>
        ) : null}
      </header>

      {firstRun ? (
        <div className="first-run">
          <p className="note">No feeds yet.</p>
          <AddFeedDialog onSubscribed={retryCalendar} onImported={retryCalendar} />
        </div>
      ) : (
        <div className="with-aside">
          <div ref={stream}>
            <DigestList
              start={start}
              onRetry={retryCalendar}
              empty={start.from ? 'Nothing on or before this day.' : 'Nothing yet.'}
              onOpenItem={onOpenItem}
              onOpenFeed={onOpenFeed}
            />
          </div>
          {shown ? (
            <DigestMonth
              calendar={shown}
              selected={start.from ?? shown.today}
              onPick={readFrom}
              onToday={start.from ? () => readFrom(undefined) : undefined}
            />
          ) : null}
        </div>
      )}
    </div>
  )
}

function DayPicker({
  calendar,
  from,
  onFrom,
}: {
  calendar: DigestCalendar
  from: DateKey | undefined
  onFrom(day: DateKey): void
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
        onClick={(event) => event.currentTarget.showPicker()}
        onChange={(event) => {
          const day = dateKeySchema.safeParse(event.target.value)
          if (day.success) onFrom(day.data)
        }}
      />
    </label>
  )
}
