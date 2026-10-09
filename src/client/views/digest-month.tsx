import { Button } from '@base-ui/react/button'
import { useState } from 'react'
import type { DigestCalendar } from '../../shared/api.js'
import { cadenceDayLabel, relativeLevels } from '../cadence.js'
import { CadenceLegend } from '../components/cadence-grid.js'
import { Group } from '../components/group.js'
import { Icon } from '../components/icon.js'
import { Row } from '../components/row.js'
import { counted, longDay, monthOfYear } from '../day-names.js'

interface DigestMonthProps {
  readonly calendar: DigestCalendar
  /** The day the Digest starts from, ringed. */
  readonly selected: string
  onPick(date: string): void
}

/**
 * The whole Digest a month at a time, each day shaded by its count against the
 * window's other days; a day with items starts the Digest there. It opens on
 * the month of the day on show and turns back as far as the window reaches.
 */
export function DigestMonth({ calendar, selected, onPick }: DigestMonthProps) {
  const [month, setMonth] = useState(selected.slice(0, 7))
  const [following, setFollowing] = useState(selected)
  if (following !== selected) {
    setFollowing(selected)
    setMonth(selected.slice(0, 7))
  }

  const counts = new Map(calendar.days.map(({ date, count }) => [date, count]))
  const levelOf = relativeLevels(calendar.days.map(({ count }) => count))
  const earliest = (calendar.days[0]?.date ?? calendar.today).slice(0, 7)
  const latest = calendar.today.slice(0, 7)
  const monthTitle = monthOfYear(`${month}-01`)

  return (
    <Group
      id="digest-calendar"
      title={monthTitle}
      className="panel digest-calendar"
      aside={
        <div className="calendar-turns">
          <Button
            className="button button-icon button-small"
            aria-label="Previous month"
            disabled={month <= earliest}
            onClick={() => setMonth(shiftMonth(month, -1))}
          >
            <Icon name="chevron-left" />
          </Button>
          <Button
            className="button button-icon button-small"
            aria-label="Next month"
            disabled={month >= latest}
            onClick={() => setMonth(shiftMonth(month, 1))}
          >
            <Icon name="chevron-right" />
          </Button>
        </div>
      }
    >
      <div className="calendar" role="group" aria-label={`Days of ${monthTitle}`}>
        {WEEKDAY_INITIALS.map((initial, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: the seven weekdays never reorder, and two share an initial.
          <span key={index} className="calendar-weekday" aria-hidden="true">
            {initial}
          </span>
        ))}
        {weeksOf(month).map((date) => {
          const count = counts.get(date)
          const outside = date.slice(0, 7) === month ? undefined : ''
          const day = Number(date.slice(8, 10))
          if (count === undefined || count === 0) {
            return (
              <span
                key={date}
                className="calendar-day"
                data-level={count === 0 ? 0 : undefined}
                data-outside={outside}
                aria-hidden="true"
              >
                {day}
              </span>
            )
          }
          return (
            <button
              key={date}
              type="button"
              className="calendar-day"
              data-level={levelOf(count)}
              data-outside={outside}
              aria-pressed={date === selected}
              aria-label={cadenceDayLabel({ date, count, level: levelOf(count) })}
              onClick={() => onPick(date)}
            >
              {day}
            </button>
          )
        })}
      </div>
      <CadenceLegend />
      <dl className="rows calendar-facts">
        <Row label={longDay(selected)} value={counted(counts.get(selected) ?? 0, 'item')} />
      </dl>
    </Group>
  )
}

const WEEKDAY_INITIALS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'] as const

const DAY_MS = 86_400_000

function shiftMonth(month: string, by: number): string {
  const [year, index] = month.split('-').map(Number)
  return new Date(Date.UTC(year ?? 0, (index ?? 1) - 1 + by, 1)).toISOString().slice(0, 7)
}

/** Every day of the weeks the month touches, Monday first. */
function weeksOf(month: string): string[] {
  const first = Date.parse(`${month}-01T00:00:00Z`)
  const start = first - ((new Date(first).getUTCDay() + 6) % 7) * DAY_MS
  const end = Date.parse(`${shiftMonth(month, 1)}-01T00:00:00Z`)
  const days = Math.ceil((end - start) / DAY_MS / 7) * 7
  return Array.from({ length: days }, (_, index) => new Date(start + index * DAY_MS).toISOString().slice(0, 10))
}
