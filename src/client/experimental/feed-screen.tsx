import { Button } from '@base-ui/react/button'
import { use, useEffect, useState, useTransition } from 'react'
import {
  CADENCE_STRIP_DAYS,
  type DateKey,
  type DigestStart,
  type FeedAvailability,
  type FeedDetail,
  POLLING_INTERVAL_MINUTES,
  type PollingIntervalMinutes,
  type ReadingSource,
} from '../../shared/api.js'
import { RHYTHM_LABELS, rhythmOf } from '../../shared/rhythm.js'
import { useScreenTitle } from '../arrival.js'
import {
  ApiError,
  fetchFeedDetail,
  fetchFeedItems,
  refreshFeed,
  updatePollingInterval,
  updateReadingSource,
} from '../api.js'
import { cadenceDayLabel, cadenceGrid } from '../cadence.js'
import { withSaved } from '../components/save-toggle.js'
import { counted, dayOfYear, dayTitle } from '../day-names.js'
import { READING_SOURCE_OPTIONS } from '../reading-source.js'
import { usePagedResource, useResource, valueInView } from '../use-resource.js'
import { unavailableNote, retryFailure } from '../views/feed-language.js'
import { ago, INTERVALS } from '../views/feed-view.js'
import { ArmContent, BloomState } from './bloom.js'
import { ArmButton, ArmOutLink, DayCalendar, ItemRow, LedgerRow, OlderDays, Options } from './parts.js'

interface FeedScreenProps {
  readonly feedId: number
  onOpenItem(feedItemId: number, feedTitle: string): void
}

export function FeedScreen({ feedId, onOpenItem }: FeedScreenProps) {
  const [state, { retry, set }] = useResource(String(feedId), (signal) => fetchFeedDetail(feedId, signal), {
    dropOnNewKey: true,
  })
  const detail = valueInView(state)
  useScreenTitle(detail?.title)
  const [itemsState, pages] = usePagedResource(
    String(feedId),
    (start: DigestStart | undefined, signal) => fetchFeedItems(feedId, start ?? {}, signal),
    (shown, page) => ({ ...shown, items: [...shown.items, ...page.items], nextFrom: page.nextFrom }),
    { dropOnNewKey: true },
  )
  const items = valueInView(itemsState)
  const [notice, setNotice] = useState('')
  const [refreshing, startRefresh] = useTransition()
  const [changing, startChange] = useTransition()
  const [wanted, setWanted] = useState<DateKey>()
  const { close } = use(BloomState)

  useEffect(() => {
    if (wanted === undefined || pages.older === 'loading' || pages.older === 'failed') return
    document.getElementById(dayAnchor(wanted))?.scrollIntoView({ block: 'start' })
    setWanted(undefined)
  }, [wanted, pages.older, items])

  if (!detail) {
    const missing =
      (state.kind === 'unavailable' || state.kind === 'unreachable') &&
      state.error instanceof ApiError &&
      state.error.status === 404
    return (
      <div className="x-screen">
        <header className="x-ledger">
          <LedgerRow label={<h1 className="x-heading">Feed</h1>}>
            {state.kind === 'loading' ? (
              <span className="x-grey">Loading the Feed</span>
            ) : missing ? (
              'That Feed isn’t among your Subscriptions.'
            ) : (
              <>
                The Feed didn’t load.{' '}
                <Button className="x-more" onClick={retry}>
                  Retry
                </Button>
              </>
            )}
          </LedgerRow>
        </header>
      </div>
    )
  }

  const showDay = (date: DateKey) => {
    close()
    if (document.getElementById(dayAnchor(date)) || !items?.nextFrom) {
      document.getElementById(dayAnchor(date))?.scrollIntoView({ block: 'start' })
      return
    }
    setWanted(date)
    pages.loadMore({ from: items.nextFrom, through: date })
  }

  const change = (work: () => Promise<Partial<FeedDetail>>, failure: string) => {
    if (changing) return
    setNotice('')
    startChange(async () => {
      try {
        const changed = await work()
        set((current) => ({ ...current, ...changed }))
      } catch {
        setNotice(failure)
      }
    })
  }

  const refresh = () => {
    if (refreshing) return
    setNotice('')
    startRefresh(async () => {
      try {
        const { observedItems } = await refreshFeed(feedId)
        setNotice(`Refreshed. The Feed shows ${counted(observedItems, 'Feed Item')}.`)
      } catch (error) {
        setNotice(retryFailure(error))
      }
      retry()
      pages.retry()
    })
  }

  const recent = detail.cadence.slice(-CADENCE_STRIP_DAYS).map(({ count }) => count)
  const rhythm = rhythmOf(recent)
  const grid = cadenceGrid(detail.cadence)
  const today = detail.cadence.at(-1)?.date ?? detail.subscribedDate
  const days = items ? Map.groupBy(items.items, (item) => item.date) : undefined

  return (
    <div className="x-screen" data-rhythm={rhythm}>
      <header className="x-ledger">
        <LedgerRow
          label="Feed"
          end={
            detail.availability.lastCheckedAt
              ? `Checked ${ago(detail.availability.lastCheckedAt).toLowerCase()}`
              : 'Not checked yet'
          }
        >
          <h1 className="x-heading x-tinted">{detail.title}</h1>
        </LedgerRow>
        {detail.homePageUrl ? (
          <LedgerRow label="Home page">
            <a className="x-link" href={detail.homePageUrl} target="_blank" rel="noopener noreferrer">
              {detail.domain}
            </a>
          </LedgerRow>
        ) : null}
        {detail.description ? <LedgerRow label="Description">{detail.description}</LedgerRow> : null}
        <LedgerRow
          label="Rhythm"
          end={`${counted(
            recent.reduce((sum, count) => sum + count, 0),
            'Feed Item',
          )} across ${recent.filter((count) => count > 0).length} of the last 30 days`}
        >
          <span className="x-tinted">{RHYTHM_LABELS[rhythm]}</span>
        </LedgerRow>
        <LedgerRow label="Availability">{availabilityOf(detail.availability)}</LedgerRow>
        <LedgerRow label="Polling interval">
          <Options
            label="Polling interval"
            className="x-words"
            options={POLLING_INTERVAL_MINUTES.map((minutes) => ({ value: String(minutes), label: INTERVALS[minutes] }))}
            value={String(detail.schedule.pollingIntervalMinutes)}
            onChange={(chosen) => {
              const minutes = POLLING_INTERVAL_MINUTES.find((offered) => String(offered) === chosen)
              if (minutes !== undefined) change(() => intervalOf(feedId, minutes), 'The interval couldn’t be changed.')
            }}
          />
        </LedgerRow>
        <LedgerRow label="Reading Source">
          <Options
            label="Reading Source"
            className="x-words"
            options={READING_SOURCE_OPTIONS}
            value={detail.readingSource}
            onChange={(source: ReadingSource) =>
              change(() => updateReadingSource(feedId, source), 'The Reading Source couldn’t be changed.')
            }
          />
        </LedgerRow>
        <LedgerRow label="Subscribed">{dayOfYear(detail.subscribedDate, today)}</LedgerRow>
        <LedgerRow label="Cadence" end="26 weeks">
          <div className="x-cadence" role="group" aria-label={`26 weeks of Cadence for ${detail.title}`}>
            {grid.columns.flatMap((column) =>
              column.cells.map((cell) =>
                cell.count > 0 ? (
                  <button
                    key={cell.date}
                    type="button"
                    data-level={cell.level}
                    aria-label={`${cadenceDayLabel(cell)}, show that day`}
                    title={cadenceDayLabel(cell)}
                    onClick={() => showDay(cell.date)}
                  />
                ) : (
                  <i key={cell.date} />
                ),
              ),
            )}
          </div>
        </LedgerRow>
        <p className="x-grid x-notice" aria-live="polite">
          <span className="x-c-main">{notice}</span>
        </p>
      </header>

      {days === undefined ? (
        <p className="x-grid x-notice">
          <span className="x-c-main x-grey">
            {itemsState.kind === 'loading' ? 'Loading the Feed Items' : 'The Feed Items didn’t load.'}
          </span>
        </p>
      ) : days.size === 0 ? (
        <p className="x-grid x-notice">
          <span className="x-c-main x-grey">Nothing retained from this Feed yet.</span>
        </p>
      ) : (
        <div className="x-plain">
          {[...days].map(([date, dayItems]) => (
            <section key={date} className="x-day x-grid" aria-labelledby={dayAnchor(date)}>
              <h2 className="x-day-label" id={dayAnchor(date)}>
                {dayTitle(date, today)}
              </h2>
              <div className="x-rows">
                {dayItems.map((item) => (
                  <ItemRow
                    key={item.feedItemId}
                    item={item}
                    onOpen={(feedItemId) => onOpenItem(feedItemId, detail.title)}
                    onSaved={(feedItemId, saved) =>
                      pages.set((current) => ({ ...current, items: withSaved(current.items, feedItemId, saved) }))
                    }
                  />
                ))}
              </div>
            </section>
          ))}
          <OlderDays
            nextFrom={items?.nextFrom ?? null}
            older={pages.older}
            onMore={(from) => pages.loadMore({ from })}
          />
        </div>
      )}

      <div className="x-legend x-grid" data-plain="" aria-hidden="true">
        <span className="x-c-label">Day</span>
        <span className="x-legend-title">Title</span>
        <span className="x-legend-time">Time</span>
      </div>

      <ArmContent side="e">
        <ArmButton busy={refreshing} onClick={refresh}>
          {refreshing ? 'Refreshing' : 'Refresh now'}
        </ArmButton>
        {detail.homePageUrl ? <ArmOutLink href={detail.homePageUrl}>Open the home page</ArmOutLink> : null}
      </ArmContent>
      <ArmContent side="s">
        <DayCalendar heading="Cadence" today={today} days={detail.cadence} onPick={showDay} />
      </ArmContent>
    </div>
  )
}

function availabilityOf(availability: FeedAvailability): string {
  switch (availability.state) {
    case 'available':
      return 'Available'
    case 'unchecked':
      return 'Not checked yet'
    case 'unavailable':
      return unavailableNote(availability)
  }
}

async function intervalOf(feedId: number, minutes: PollingIntervalMinutes): Promise<Partial<FeedDetail>> {
  return { schedule: await updatePollingInterval(feedId, minutes) }
}

function dayAnchor(date: string): string {
  return `feed-day-${date}`
}
