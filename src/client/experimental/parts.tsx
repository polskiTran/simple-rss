import { Button } from '@base-ui/react/button'
import { Toggle } from '@base-ui/react/toggle'
import { ToggleGroup } from '@base-ui/react/toggle-group'
import { createContext, type ReactNode, use } from 'react'
import { type CadenceObservation, type DateKey, type SubscriptionSummary, utcDayKey } from '../../shared/api.js'
import { RHYTHMS, RHYTHM_LABELS, type Rhythm } from '../../shared/rhythm.js'
import { RoutedLink } from '../components/routed-link.js'
import { SaveToggle } from '../components/save-toggle.js'
import { counted, fullDate, monthName } from '../day-names.js'
import { feedPath, readerPath } from '../routing.js'
import type { OlderState } from '../use-resource.js'

interface Subscriptions {
  readonly list: readonly SubscriptionSummary[] | undefined
  readonly rhythms: ReadonlyMap<number, Rhythm> | undefined
}

export const SubscriptionsContext = createContext<Subscriptions>({ list: undefined, rhythms: undefined })

export function useRhythmOf() {
  const { rhythms } = use(SubscriptionsContext)
  return (feedId: number): Rhythm => rhythms?.get(feedId) ?? 'inactive'
}

export function LedgerRow({
  label,
  side,
  end,
  children,
}: {
  readonly label: ReactNode
  readonly side?: ReactNode
  readonly end?: ReactNode
  readonly children?: ReactNode
}) {
  return (
    <div className="x-grid x-ledger-row">
      <div className="x-c-label">{label}</div>
      <div className="x-c-main">{children}</div>
      {side === undefined ? null : <div className="x-c-side">{side}</div>}
      {end === undefined ? null : <div className="x-c-end">{end}</div>}
    </div>
  )
}

export function TierKey() {
  return (
    <span className="x-tier-key">
      {RHYTHMS.filter((rhythm) => rhythm !== 'inactive').map((rhythm) => (
        <span key={rhythm} data-rhythm={rhythm}>
          {RHYTHM_LABELS[rhythm]}
        </span>
      ))}
    </span>
  )
}

export function FeedLink({
  feedId,
  title,
  rhythm,
  onOpen,
}: {
  readonly feedId: number
  readonly title: string
  readonly rhythm: Rhythm
  onOpen(feedId: number): void
}) {
  return (
    <RoutedLink className="x-feed" data-rhythm={rhythm} href={feedPath(feedId)} onNavigate={() => onOpen(feedId)}>
      {title}
    </RoutedLink>
  )
}

interface ListedItem {
  readonly feedItemId: number
  readonly title: string
  readonly saved: boolean
  readonly displayTime: string | null
}

export function SaveWord({ item, onSaved }: { readonly item: ListedItem; onSaved(saved: boolean): void }) {
  return (
    <SaveToggle
      className="x-save"
      feedItemId={item.feedItemId}
      title={item.title}
      saved={item.saved}
      onSaved={onSaved}
    />
  )
}

export function TitleLink({ item, onOpen }: { readonly item: ListedItem; onOpen(feedItemId: number): void }) {
  return (
    <RoutedLink href={readerPath(item.feedItemId)} onNavigate={() => onOpen(item.feedItemId)}>
      {item.title}
    </RoutedLink>
  )
}

export function ItemRow({
  item,
  feed,
  onOpen,
  onSaved,
}: {
  readonly item: ListedItem
  readonly feed?: ReactNode
  onOpen(feedItemId: number): void
  onSaved(feedItemId: number, saved: boolean): void
}) {
  return (
    <div className="x-row" data-saved={item.saved ? '' : undefined}>
      <span className="x-t">
        <TitleLink item={item} onOpen={onOpen} />
      </span>
      {feed === undefined ? null : <span className="x-f">{feed}</span>}
      <span className="x-d">
        <SaveWord item={item} onSaved={(saved) => onSaved(item.feedItemId, saved)} />
        {item.displayTime}
      </span>
    </div>
  )
}

export function OlderDays({
  nextFrom,
  older,
  onMore,
}: {
  readonly nextFrom: DateKey | null
  readonly older: OlderState
  onMore(from: DateKey): void
}) {
  if (nextFrom === null) return null
  return (
    <div className="x-grid x-older">
      <div className="x-c-main">
        <Button
          className="x-more"
          focusableWhenDisabled
          disabled={older === 'loading'}
          aria-busy={older === 'loading'}
          onClick={() => onMore(nextFrom)}
        >
          {older === 'loading' ? 'Loading older days' : older === 'failed' ? 'Retry older days' : 'Show older days'}
        </Button>
        {older === 'failed' ? (
          <span className="x-grey" role="status">
            {' '}
            Older days are out of reach.
          </span>
        ) : null}
      </div>
    </div>
  )
}

interface Option<Value extends string> {
  readonly value: Value
  readonly label: string
  readonly disabled?: boolean
}

export function Options<const Value extends string>({
  label,
  options,
  value,
  className = 'x-options',
  onChange,
}: {
  readonly label: string
  readonly options: readonly Option<Value>[]
  readonly value: NoInfer<Value>
  readonly className?: string
  onChange(value: NoInfer<Value>): void
}) {
  return (
    <ToggleGroup
      className={className}
      aria-label={label}
      value={[value]}
      onValueChange={(chosen) => {
        const next = options.find((option) => option.value === chosen[0])
        if (next && next.value !== value) onChange(next.value)
      }}
    >
      {options.map((option) => (
        <Toggle
          key={option.value}
          className="x-opt"
          value={option.value}
          disabled={option.disabled ?? false}
          aria-disabled={option.disabled ? true : undefined}
        >
          <i className="x-mark" />
          {option.label}
        </Toggle>
      ))}
    </ToggleGroup>
  )
}

export function ArmHeading({ children, end }: { readonly children: ReactNode; readonly end?: ReactNode }) {
  return (
    <h2 className="x-arm-heading">
      {children}
      {end === undefined ? null : <span className="x-arm-heading-end">{end}</span>}
    </h2>
  )
}

export function ArmLink({
  href,
  current = false,
  end,
  onNavigate,
  children,
}: {
  readonly href: string
  readonly current?: boolean
  readonly end?: ReactNode
  onNavigate(): void
  readonly children: ReactNode
}) {
  return (
    <RoutedLink className="x-opt" href={href} aria-current={current ? 'page' : undefined} onNavigate={onNavigate}>
      <i className="x-mark" />
      <span className="x-opt-label">{children}</span>
      {end === undefined ? null : <span className="x-opt-end">{end}</span>}
    </RoutedLink>
  )
}

export function ArmButton({
  busy = false,
  onClick,
  children,
}: {
  readonly busy?: boolean
  onClick(): void
  readonly children: ReactNode
}) {
  return (
    <Button className="x-opt" focusableWhenDisabled disabled={busy} aria-busy={busy} onClick={onClick}>
      <i className="x-mark" />
      <span className="x-opt-label">{children}</span>
    </Button>
  )
}

export function ArmOutLink({ href, children }: { readonly href: string; readonly children: ReactNode }) {
  return (
    <a className="x-opt" href={href} target="_blank" rel="noopener noreferrer">
      <i className="x-mark" />
      <span className="x-opt-label">{children}</span>
    </a>
  )
}

const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'] as const
const CALENDAR_DAYS = 35
const DAY_MS = 86_400_000

export function DayCalendar({
  heading,
  today,
  days,
  current,
  onPick,
}: {
  readonly heading: string
  readonly today: DateKey
  readonly days: readonly CadenceObservation[]
  readonly current?: DateKey | undefined
  onPick(date: DateKey): void
}) {
  const counts = new Map(days.map(({ date, count }) => [date, count]))
  const peak = Math.max(1, ...counts.values())
  const noon = Date.parse(`${today}T12:00:00Z`)
  const weekday = (new Date(noon).getUTCDay() + 6) % 7
  const first = noon - (weekday + 28) * DAY_MS
  const cells = Array.from({ length: CALENDAR_DAYS }, (_, index) => utcDayKey(first + index * DAY_MS))
  return (
    <div className="x-calendar">
      <ArmHeading end={monthName(today.slice(0, 7), today)}>{heading}</ArmHeading>
      <div className="x-calendar-grid" role="group" aria-label={heading}>
        {WEEKDAYS.map((day) => (
          <span key={day} aria-hidden="true">
            {day.charAt(0)}
          </span>
        ))}
        {cells.map((date) => {
          if (date > today) return <span key={date} aria-hidden="true" />
          const count = counts.get(date) ?? 0
          const label = `${counted(count, 'Feed Item')} on ${fullDate(date)}`
          return (
            <button
              key={date}
              type="button"
              disabled={count === 0}
              data-today={date === today ? '' : undefined}
              aria-current={date === current ? 'date' : undefined}
              aria-label={label}
              title={label}
              style={count > 0 ? { '--strength': `${Math.round(35 + (65 * count) / peak)}%` } : undefined}
              onClick={() => onPick(date)}
            >
              {Number(date.slice(8))}
            </button>
          )
        })}
      </div>
    </div>
  )
}
