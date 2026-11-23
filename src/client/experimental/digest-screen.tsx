import { Button } from '@base-ui/react/button'
import { use, useEffect } from 'react'
import { z } from 'zod'
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
import { withSaved } from '../components/save-toggle.js'
import { counted, dayTitle, longDay } from '../day-names.js'
import { useKept } from '../routing.js'
import { useStoredChoice } from '../stored-choice.js'
import { usePagedResource, useResource, valueInView } from '../use-resource.js'
import { ArmContent } from './bloom.js'
import { digestCounts, FIREHOSE_TREATMENT, type FirehoseTreatment, splitDay, timeSpan } from './firehose.js'
import {
  ArmHeading,
  DayCalendar,
  FeedLink,
  ItemRow,
  LedgerRow,
  OlderDays,
  Options,
  SaveWord,
  SubscriptionsContext,
  TierKey,
  TitleLink,
  useRhythmOf,
} from './parts.js'

interface DigestScreenProps {
  readonly start: DigestStart
  onStart(start: DigestStart): void
  onOpenItem(feedItemId: number): void
  onOpenFeed(feedId: number): void
  onAddFeed(): void
}

interface RowActions {
  onOpenItem(feedItemId: number): void
  onOpenFeed(feedId: number): void
  onSaved(feedItemId: number, saved: boolean): void
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

  const ready = digest !== undefined && rhythms !== undefined
  const failed = state.kind === 'unavailable' || state.kind === 'unreachable'

  return (
    <div className="x-screen">
      <header className="x-ledger">
        <LedgerRow
          label={<h1 className="x-heading">Digest</h1>}
          side={<TierKey />}
          end={today ? longDay(start.from ?? today) : undefined}
        >
          {days?.subscriptions === 0 ? (
            <>
              No Feeds yet.{' '}
              <Button className="x-more" onClick={onAddFeed}>
                Add a Feed
              </Button>
            </>
          ) : ready ? (
            summary(digest.groups, isFirehose, start.from !== undefined)
          ) : failed ? (
            <>
              The Digest didn’t load.{' '}
              <Button className="x-more" onClick={retry}>
                Retry
              </Button>
            </>
          ) : (
            <span className="x-grey">Loading the Digest</span>
          )}
        </LedgerRow>
      </header>

      {ready ? (
        <div aria-busy={state.kind === 'loading'}>
          {digest.groups.map((group) => (
            <Day
              key={group.date}
              group={group}
              today={digest.today}
              treatment={treatment}
              isFirehose={isFirehose}
              actions={actions}
            />
          ))}
          <OlderDays nextFrom={digest.nextFrom} older={older} onMore={loadMore} />
        </div>
      ) : null}

      <Legend treatment={treatment} />

      {days && today ? (
        <ArmContent side="s">
          <DayCalendar
            heading="Days"
            today={today}
            days={days.days}
            current={start.from ?? today}
            onPick={(date) => onStart({ from: date === days.today ? undefined : date })}
          />
        </ArmContent>
      ) : null}
      <ArmContent side="w">
        <ArmHeading>Firehose</ArmHeading>
        <Options
          label="Firehose"
          options={[
            { value: 'fold', label: 'Fold' },
            { value: 'lane', label: 'Lane' },
          ]}
          value={treatment}
          onChange={FIREHOSE_TREATMENT.choose}
        />
      </ArmContent>
    </div>
  )
}

function summary(groups: readonly DigestGroup[], isFirehose: (feedId: number) => boolean, picked: boolean): string {
  const counts = digestCounts(groups, isFirehose)
  if (counts.items + counts.firehose === 0) return picked ? 'Nothing on or before this day.' : 'Nothing yet.'
  const calm = `${counted(counts.items, 'Feed Item')} from ${counted(counts.subscriptions, 'Subscription')}`
  return counts.firehose === 0 ? calm : `${calm}, and ${counts.firehose.toLocaleString('en-GB')} from Firehose Feeds`
}

function Day({
  group,
  today,
  treatment,
  isFirehose,
  actions,
}: {
  readonly group: DigestGroup
  readonly today: DateKey
  readonly treatment: FirehoseTreatment
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
      <div className="x-rows">
        {group.returns.map(({ feedId, quietDays }) => (
          <div key={feedId} className="x-row x-note">
            <span className="x-t">
              {group.items.find((item) => item.feedId === feedId)?.feedTitle ?? 'A Feed'} is back after{' '}
              {quietDays < 60 ? `${quietDays} quiet days` : `${Math.round(quietDays / 30)} quiet months`}
            </span>
          </div>
        ))}
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
      {lane.length > 0 ? (
        <aside className="x-lane" aria-label={`Firehose, ${dayTitle(group.date, today)}`}>
          <p className="x-lane-head">Firehose, {counted(lane.length, 'Feed Item')}</p>
          {lane.map((item) => (
            <div key={item.feedItemId} className="x-lane-item" data-saved={item.saved ? '' : undefined}>
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
  const [open = false, keepOpen] = useKept(`fold ${date} ${latest?.feedId}`, z.boolean())
  if (!latest) return null
  const count = counted(items.length, 'Feed Item')
  return (
    <div className="x-fold" data-open={open ? '' : undefined}>
      <div className="x-row x-fold-head">
        <span className="x-t">
          <Button
            className="x-more"
            aria-expanded={open}
            aria-label={`${open ? `Fold ${count}` : count} from ${latest.feedTitle}`}
            onClick={() => keepOpen(open ? undefined : true)}
          >
            {open ? 'Fold' : count}
          </Button>
          <span className="x-grey">{open ? `, ${count}` : `\u2002${latest.title}`}</span>
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
      {open
        ? items.map((item) => (
            <ItemRow key={item.feedItemId} item={item} onOpen={actions.onOpenItem} onSaved={actions.onSaved} />
          ))
        : null}
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
