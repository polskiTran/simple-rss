import { Button } from '@base-ui/react/button'
import { Toggle } from '@base-ui/react/toggle'
import { ToggleGroup } from '@base-ui/react/toggle-group'
import { type ComponentProps, createContext, type ReactNode, use } from 'react'
import { type CadenceObservation, type DateKey, type SubscriptionSummary, utcDayKey } from '../../shared/api.js'
import { type Rhythm, rhythmOf } from '../../shared/rhythm.js'
import { RoutedLink } from './routed-link.js'
import { SaveToggle } from './save-toggle.js'
import { counted, fullDate } from '../day-names.js'
import { feedPath, type Origin, readerPath } from '../routing.js'
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

export function Notice({
  grey = false,
  className,
  children,
  ...line
}: ComponentProps<'p'> & { readonly grey?: boolean }) {
  return (
    <p {...line} className={className ? `x-grid x-notice ${className}` : 'x-grid x-notice'}>
      <span className={grey ? 'x-c-main x-grey' : 'x-c-main'}>{children}</span>
    </p>
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

export function FeedRow({
  feed,
  onOpen,
  children,
}: {
  readonly feed: Pick<SubscriptionSummary, 'feedId' | 'title' | 'domain' | 'cadence'>
  onOpen(feedId: number): void
  readonly children?: ReactNode
}) {
  return (
    <div className="x-row">
      <span className="x-t">
        <FeedLink feedId={feed.feedId} title={feed.title} rhythm={rhythmOf(feed.cadence)} onOpen={onOpen} />
        {children}
      </span>
      <span className="x-f x-grey">{feed.domain}</span>
      <span className="x-d">{feed.cadence.reduce((sum, count) => sum + count, 0).toLocaleString('en-GB')}</span>
    </div>
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

export function TitleLink({
  item,
  onOpen,
  children = item.title,
}: {
  readonly item: ListedItem
  onOpen(feedItemId: number): void
  readonly children?: ReactNode
}) {
  return (
    <RoutedLink href={readerPath(item.feedItemId)} onNavigate={() => onOpen(item.feedItemId)}>
      {children}
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

export function OlderDays<Cursor extends string>({
  nextFrom,
  older,
  noun = 'days',
  onMore,
}: {
  readonly nextFrom: Cursor | null
  readonly older: OlderState
  readonly noun?: string
  onMore(from: Cursor): void
}) {
  if (nextFrom === null) return null
  return (
    <div className="x-grid x-older">
      <div className="x-c-main">
        <Button
          className="x-action"
          focusableWhenDisabled
          disabled={older === 'loading'}
          aria-busy={older === 'loading'}
          onClick={() => onMore(nextFrom)}
        >
          {older === 'loading'
            ? `Loading older ${noun}`
            : older === 'failed'
              ? `Retry older ${noun}`
              : `Show older ${noun}`}
        </Button>
        {older === 'failed' ? (
          <span className="x-grey" role="status">
            {' '}
            Older {noun} are out of reach.
          </span>
        ) : null}
      </div>
    </div>
  )
}

export function BackLink({ origin, onBack }: { readonly origin: Origin; onBack(origin: Origin): void }) {
  return (
    <RoutedLink className="x-grey x-link x-back" href={origin.path} onNavigate={() => onBack(origin)}>
      {origin.label ?? 'Back'}
    </RoutedLink>
  )
}

export function LoadFailure({
  subject,
  kind,
  onRetry,
}: {
  readonly subject: string
  readonly kind: 'unavailable' | 'unreachable'
  onRetry(): void
}) {
  return (
    <>
      {subject} {kind === 'unreachable' ? 'can’t be reached.' : 'didn’t load.'}{' '}
      <Button className="x-action" onClick={onRetry}>
        Retry
      </Button>
    </>
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
  className,
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
      className={className ? `x-words ${className}` : 'x-words'}
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
          {option.label}
        </Toggle>
      ))}
    </ToggleGroup>
  )
}

const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'] as const
const CALENDAR_DAYS = 35
const DAY_MS = 86_400_000

export function DayCalendar({
  label,
  today,
  days,
  current,
  onPick,
}: {
  readonly label: string
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
    <div className="x-calendar" role="group" aria-label={label}>
      {WEEKDAYS.map((day) => (
        <span key={day} aria-hidden="true">
          {day.charAt(0)}
        </span>
      ))}
      {cells.map((date) => {
        if (date > today) return <span key={date} aria-hidden="true" />
        const count = counts.get(date) ?? 0
        const described = `${counted(count, 'Feed Item')} on ${fullDate(date)}`
        return (
          <button
            key={date}
            type="button"
            disabled={count === 0}
            data-today={date === today ? '' : undefined}
            aria-current={date === current ? 'date' : undefined}
            aria-label={described}
            title={described}
            style={count > 0 ? { '--strength': `${Math.round(35 + (65 * count) / peak)}%` } : undefined}
            onClick={() => onPick(date)}
          >
            {Number(date.slice(8))}
          </button>
        )
      })}
    </div>
  )
}
