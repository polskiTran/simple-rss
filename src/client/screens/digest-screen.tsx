import { Button } from '@base-ui/react/button'
import { use, useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  type DateKey,
  dateKeySchema,
  type DigestGroup,
  type DigestItem,
  digestParamsOf,
  type DigestStart,
} from '../../shared/api.js'
import { useScreenTitle } from '../arrival.js'
import { fetchDigest, fetchDigestCalendar } from '../api.js'
import { RoutedLink } from '../components/routed-link.js'
import { playArrivals, playDayChange } from '../motion.js'
import { withSaved } from '../components/save-toggle.js'
import { counted, dayTitle, longDay } from '../day-names.js'
import { sectionPath, useKept } from '../routing.js'
import { useStoredChoice } from '../stored-choice.js'
import { usePagedResource, useResource, valueInView } from '../use-resource.js'
import {
  DIGEST_LAYOUT,
  type DigestLayout,
  LAYOUT_LABELS,
  Pictures,
  type RowActions,
  FoldToggle,
  useFold,
} from './digest-layouts.js'
import { FIREHOSE_TREATMENT, type FirehoseTreatment, splitDay, timeSpan } from './firehose.js'
import {
  DayCalendar,
  FeedLink,
  ItemRow,
  LedgerRow,
  OlderDays,
  Options,
  SaveWord,
  SubscriptionsContext,
  TitleLink,
  useRhythmOf,
  LoadFailure,
} from '../components/ledger.js'

interface DigestScreenProps {
  readonly start: DigestStart
  onStart(start: DigestStart): void
  onOpenItem(feedItemId: number): void
  onOpenFeed(feedId: number): void
  onAddFeed(): void
}

export function DigestScreen({ start, onStart, onOpenItem, onOpenFeed, onAddFeed }: DigestScreenProps) {
  useScreenTitle('Digest')
  const [calendar] = useResource('calendar', fetchDigestCalendar)
  const [through, keepThrough] = useKept('through', dateKeySchema)
  const [state, { retry, set, loadMore, older }] = usePagedResource(
    digestParamsOf(start).toString(),
    (from: DateKey | undefined, signal) => fetchDigest(from ? { from } : { ...start, through }, signal),
    (shown, page) => ({ ...shown, groups: [...shown.groups, ...page.groups], nextFrom: page.nextFrom }),
  )
  const oldestShown = state.kind === 'loaded' ? state.value.groups.at(-1)?.date : undefined
  useEffect(() => {
    if (oldestShown) keepThrough(oldestShown)
  }, [oldestShown, keepThrough])

  const treatment = useStoredChoice(FIREHOSE_TREATMENT)
  const layout = useStoredChoice(DIGEST_LAYOUT)
  const { rhythms } = use(SubscriptionsContext)
  const rhythmOf = useRhythmOf()
  const isFirehose = (feedId: number) => rhythmOf(feedId) === 'firehose'
  const digest = valueInView(state)
  const days = valueInView(calendar)
  const today = digest?.today ?? days?.today
  const actions: RowActions = {
    onOpenItem,
    onOpenFeed,
    onSaved: (feedItemId, saved) =>
      set((current) => ({
        ...current,
        groups: current.groups.map((group) => ({ ...group, items: withSaved(group.items, feedItemId, saved) })),
      })),
  }

  const [picking, setPicking] = useState(false)
  const list = useRef<HTMLDivElement>(null)
  const shownDays = useRef<{ readonly first: string; readonly count: number }>(undefined)
  const firstDay = digest?.groups[0]?.date
  const dayCount = digest?.groups.length ?? 0
  useLayoutEffect(() => {
    const before = shownDays.current
    shownDays.current = firstDay === undefined ? undefined : { first: firstDay, count: dayCount }
    if (!before || !list.current || firstDay === undefined) return
    if (firstDay !== before.first) playDayChange(list.current, firstDay < before.first ? 'older' : 'newer')
    else if (dayCount > before.count)
      playArrivals([...list.current.querySelectorAll(':scope > .x-day')].slice(before.count))
  }, [firstDay, dayCount])
  const ready = digest !== undefined && rhythms !== undefined
  const _failed = state.kind === 'unavailable' || state.kind === 'unreachable'

  const empty = ready && digest.groups.every((group) => group.items.length === 0)
  const notice =
    days?.subscriptions === 0 ? (
      <>
        No Feeds yet.{' '}
        <RoutedLink className="x-action" href={sectionPath('feeds')} onNavigate={onAddFeed}>
          Add a Feed
        </RoutedLink>
      </>
    ) : empty ? (
      start.from === undefined ? (
        'Nothing yet.'
      ) : (
        'Nothing on or before this day.'
      )
    ) : ready ? null : state.kind === 'unavailable' || state.kind === 'unreachable' ? (
      <LoadFailure subject="The Digest" kind={state.kind} onRetry={retry} />
    ) : (
      <span className="x-grey">Loading the Digest</span>
    )

  return (
    <div>
      <header className="x-ledger">
        <h1 className="visually-hidden">Digest</h1>
        {notice ? <LedgerRow label="">{notice}</LedgerRow> : null}
        <LedgerRow label="Layout">
          <Options
            label="Layout"
            options={DIGEST_LAYOUT.options.map((option) => ({ value: option, label: LAYOUT_LABELS[option] }))}
            value={layout}
            onChange={DIGEST_LAYOUT.choose}
          />
        </LedgerRow>
        <LedgerRow label="Firehose">
          <Options
            label="Firehose"
            options={[
              { value: 'fold', label: 'Fold' },
              { value: 'lane', label: 'Lane' },
            ]}
            value={treatment}
            onChange={FIREHOSE_TREATMENT.choose}
          />
        </LedgerRow>
        {today ? (
          <LedgerRow label="Day">
            <Button className="x-action" aria-expanded={picking} onClick={() => setPicking((shown) => !shown)}>
              {longDay(start.from ?? today)}
            </Button>
            {picking && days ? (
              <DayCalendar
                label="Days"
                today={today}
                days={days.days}
                current={start.from ?? today}
                onPick={(date) => {
                  setPicking(false)
                  onStart({ from: date === days.today ? undefined : date })
                }}
              />
            ) : null}
          </LedgerRow>
        ) : null}
      </header>

      {ready ? (
        <div ref={list} aria-busy={state.kind === 'loading'}>
          {digest.groups.map((group) => (
            <Day
              key={group.date}
              group={group}
              today={digest.today}
              treatment={treatment}
              layout={layout}
              isFirehose={isFirehose}
              actions={actions}
            />
          ))}
          <OlderDays nextFrom={digest.nextFrom} older={older} onMore={loadMore} />
        </div>
      ) : null}

      {layout === 'index' ? <Legend treatment={treatment} /> : null}
    </div>
  )
}

function Day({
  group,
  today,
  treatment,
  layout,
  isFirehose,
  actions,
}: {
  readonly group: DigestGroup
  readonly today: DateKey
  readonly treatment: FirehoseTreatment
  readonly layout: DigestLayout
  readonly isFirehose: (feedId: number) => boolean
  readonly actions: RowActions
}) {
  const rhythmOf = useRhythmOf()
  const { rows, lane } = splitDay(group.items, isFirehose, treatment)
  const heading = `day-${group.date}`
  const feedOf = (item: DigestItem) => (
    <FeedLink feedId={item.feedId} title={item.feedTitle} rhythm={rhythmOf(item.feedId)} onOpen={actions.onOpenFeed} />
  )
  return (
    <section className="x-day x-grid" data-lane={treatment === 'lane' ? '' : undefined} aria-labelledby={heading}>
      <h2 className="x-day-label" id={heading}>
        {dayTitle(group.date, today)}
      </h2>
      {layout !== 'index' ? (
        <Pictures layout={layout} date={group.date} rows={rows} actions={actions} />
      ) : (
        <div className="x-rows">
          {rows.map((row) =>
            row.kind === 'item' ? (
              <ItemRow
                key={row.item.feedItemId}
                item={row.item}
                feed={feedOf(row.item)}
                onOpen={actions.onOpenItem}
                onSaved={actions.onSaved}
              />
            ) : (
              <Fold key={`fold ${row.feedId}`} date={group.date} items={row.items} actions={actions} />
            ),
          )}
        </div>
      )}
      {lane.length > 0 ? (
        <aside className="x-lane" aria-label={`Firehose, ${dayTitle(group.date, today)}`}>
          <p className="x-lane-head">Firehose, {counted(lane.length, 'Feed Item')}</p>
          {lane.map((item) => (
            <div key={item.feedItemId} className="x-lane-item">
              <TitleLink item={item} onOpen={actions.onOpenItem} />
              <div className="x-lane-meta">
                {feedOf(item)}
                {item.displayTime ? <span className="x-grey">, {item.displayTime}</span> : null}
                <SaveWord item={item} onSaved={(saved) => actions.onSaved(item.feedItemId, saved)} />
              </div>
            </div>
          ))}
        </aside>
      ) : null}
    </section>
  )
}

function Fold({
  date,
  items,
  actions,
}: {
  readonly date: DateKey
  readonly items: readonly DigestItem[]
  readonly actions: RowActions
}) {
  const rhythmOf = useRhythmOf()
  const [latest] = items
  const { open, box, kept, toggle } = useFold<HTMLDivElement, HTMLDivElement>(date, latest?.feedId)
  if (!latest) return null
  return (
    <div ref={box} className="x-fold" data-open={open ? '' : undefined}>
      <div ref={kept} className="x-row x-fold-head">
        <span className="x-t">
          <FoldToggle
            open={open}
            count={counted(items.length, 'Feed Item')}
            feedTitle={latest.feedTitle}
            latest={latest.title}
            onToggle={() => void toggle()}
          />
        </span>
        <span className="x-f">
          <FeedLink
            feedId={latest.feedId}
            title={latest.feedTitle}
            rhythm={rhythmOf(latest.feedId)}
            onOpen={actions.onOpenFeed}
          />
        </span>
        <span className="x-d">{timeSpan(items)}</span>
      </div>
      {open ? (
        <div className="x-fold-body">
          {items.map((item) => (
            <ItemRow key={item.feedItemId} item={item} onOpen={actions.onOpenItem} onSaved={actions.onSaved} />
          ))}
        </div>
      ) : null}
    </div>
  )
}

function Legend({ treatment }: { readonly treatment: FirehoseTreatment }) {
  return (
    <div className="x-legend x-grid" data-lane={treatment === 'lane' ? '' : undefined} aria-hidden="true">
      <span className="x-c-label">Day</span>
      <span className="x-legend-title">Title</span>
      <span className="x-legend-feed">Feed</span>
      <span className="x-legend-time">Time</span>
      {treatment === 'lane' ? <span className="x-legend-lane">Firehose</span> : null}
    </div>
  )
}
