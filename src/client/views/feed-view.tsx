import { useEffect, useState, type CSSProperties } from 'react'
import {
  POLLING_INTERVAL_PRESETS,
  type FeedDetail,
  type PollingIntervalMinutes,
} from '../../shared/api.js'
import { ApiError, fetchFeedDetail, refreshFeed, unsubscribeFromFeed, updatePollingInterval } from '../api.js'
import { cadenceDayLabel, cadenceGrid, type CadenceGrid } from '../cadence.js'
import { SaveToggle } from '../components/save-toggle.js'
import { routedClick } from '../routed-link.js'
import { AVAILABILITY_COPY, noteDate, retryFailure } from './feed-language.js'

type DetailState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'loaded'; readonly detail: FeedDetail }
  | { readonly kind: 'missing' }
  | { readonly kind: 'unavailable' }

export interface FeedViewProps {
  readonly feedId: number
  /** Told when the Owner goes back to the Feeds list. */
  onBack(): void
}

/**
 * One Feed, explored through its cadence: the 26-week grid, the one-line
 * statistics beneath it, the retained Feed Items, and the polling behaviour —
 * interval, manual refresh, Feed Availability — the Owner manages here.
 */
export function FeedView({ feedId, onBack }: FeedViewProps) {
  const [state, setState] = useState<DetailState>({ kind: 'loading' })
  const [notice, setNotice] = useState('')
  const [refreshing, setRefreshing] = useState(false)
  const [changingInterval, setChangingInterval] = useState(false)
  const [confirmingUnsubscribe, setConfirmingUnsubscribe] = useState(false)
  const [unsubscribing, setUnsubscribing] = useState(false)

  useEffect(() => {
    let active = true
    setState({ kind: 'loading' })
    void fetchFeedDetail(feedId)
      .then((detail) => {
        if (active) setState({ kind: 'loaded', detail })
      })
      .catch((error: unknown) => {
        if (!active) return
        setState(error instanceof ApiError && error.status === 404 ? { kind: 'missing' } : { kind: 'unavailable' })
      })
    return () => {
      active = false
    }
  }, [feedId])

  /**
   * The manual refresh, which doubles as the retry when the Feed is
   * unavailable. Whatever the attempt finds, the detail is refetched so the
   * grid, the items, and the availability note all report the newest state.
   */
  async function refresh() {
    if (refreshing) return
    setRefreshing(true)
    setNotice('')
    try {
      const { observedItems } = await refreshFeed(feedId)
      setNotice(
        observedItems === 1 ? 'refreshed — the feed shows 1 item' : `refreshed — the feed shows ${observedItems} items`,
      )
    } catch (error) {
      setNotice(retryFailure(error))
    } finally {
      setRefreshing(false)
    }
    try {
      setState({ kind: 'loaded', detail: await fetchFeedDetail(feedId) })
    } catch {
      // The refresh outcome is already on screen; a failed refetch changes nothing.
    }
  }

  async function changeInterval(pollingIntervalMinutes: PollingIntervalMinutes) {
    if (changingInterval || state.kind !== 'loaded') return
    if (state.detail.schedule.pollingIntervalMinutes === pollingIntervalMinutes) return
    setChangingInterval(true)
    setNotice('')
    try {
      const schedule = await updatePollingInterval(feedId, pollingIntervalMinutes)
      setState({ kind: 'loaded', detail: { ...state.detail, schedule } })
      setNotice(`now checked ${intervalPhrase(pollingIntervalMinutes)}`)
    } catch {
      setNotice('the interval could not be changed')
    } finally {
      setChangingInterval(false)
    }
  }

  /**
   * The confirmed unsubscribe. Success returns the Owner to the Feeds list —
   * this screen describes a Subscription that no longer exists.
   */
  async function unsubscribe() {
    if (unsubscribing) return
    setUnsubscribing(true)
    setNotice('')
    try {
      await unsubscribeFromFeed(feedId)
      onBack()
    } catch {
      setNotice('the feed could not be unsubscribed')
      setUnsubscribing(false)
      setConfirmingUnsubscribe(false)
    }
  }

  /** The server confirmed a membership change; the word flips in place. */
  function setSaved(feedItemId: number, saved: boolean) {
    setState((current) =>
      current.kind === 'loaded'
        ? {
            kind: 'loaded',
            detail: {
              ...current.detail,
              items: current.detail.items.map((item) =>
                item.feedItemId === feedItemId ? { ...item, saved } : item,
              ),
            },
          }
        : current,
    )
  }

  /** A selected day moves focus and view to that day's Feed Items. */
  function showDay(date: string) {
    const day = document.getElementById(dayAnchor(feedId, date))
    if (!day) return
    day.focus({ preventScroll: true })
    day.scrollIntoView?.({ block: 'start' })
  }

  return (
    <div className="view measure feed-view">
      <p className="feed-header">
        <a className="feed-back" href="/feeds" onClick={routedClick(onBack)}>
          ← feeds
        </a>
        {state.kind === 'loaded' ? (
          <>
            <span className="feed-header-title">{state.detail.title}</span>
            <span className="feed-header-domain">{state.detail.domain}</span>
          </>
        ) : null}
      </p>
      {state.kind === 'loading' ? <p className="empty-note feed-detail-state">loading the feed</p> : null}
      {state.kind === 'missing' ? (
        <p className="empty-note feed-detail-state">that feed is not in your subscriptions</p>
      ) : null}
      {state.kind === 'unavailable' ? <p className="empty-note feed-detail-state">the feed is unavailable</p> : null}
      {state.kind === 'loaded' ? (
        <OpenFeed
          detail={state.detail}
          notice={notice}
          refreshing={refreshing}
          onRefresh={refresh}
          onChangeInterval={changeInterval}
          onShowDay={showDay}
          onSaved={setSaved}
          confirmingUnsubscribe={confirmingUnsubscribe}
          unsubscribing={unsubscribing}
          onConfirmUnsubscribe={setConfirmingUnsubscribe}
          onUnsubscribe={unsubscribe}
        />
      ) : null}
    </div>
  )
}

function OpenFeed({
  detail,
  notice,
  refreshing,
  onRefresh,
  onChangeInterval,
  onShowDay,
  onSaved,
  confirmingUnsubscribe,
  unsubscribing,
  onConfirmUnsubscribe,
  onUnsubscribe,
}: {
  detail: FeedDetail
  notice: string
  refreshing: boolean
  onRefresh: () => void
  onChangeInterval: (minutes: PollingIntervalMinutes) => void
  onShowDay: (date: string) => void
  onSaved: (feedItemId: number, saved: boolean) => void
  confirmingUnsubscribe: boolean
  unsubscribing: boolean
  onConfirmUnsubscribe: (confirming: boolean) => void
  onUnsubscribe: () => void
}) {
  const grid = cadenceGrid(detail.cadence)
  return (
    <>
      <Grid grid={grid} title={detail.title} onShowDay={onShowDay} />
      <p className="cadence-stats">{grid.stats}</p>
      <AvailabilityNote detail={detail} />
      <div className="feed-controls">
        <span className="interval-options" role="group" aria-label="checked every">
          <span className="interval-caption">checked every</span>
          {POLLING_INTERVAL_PRESETS.map((minutes) => (
            <button
              key={minutes}
              type="button"
              className="text-button interval-option"
              aria-pressed={detail.schedule.pollingIntervalMinutes === minutes}
              aria-label={`check ${intervalPhrase(minutes)}`}
              onClick={() => onChangeInterval(minutes)}
            >
              {INTERVAL_WORDS[minutes]}
            </button>
          ))}
        </span>
        <button className="text-button feed-refresh" type="button" disabled={refreshing} onClick={onRefresh}>
          {refreshing ? 'refreshing…' : 'refresh now'}
        </button>
      </div>
      <p className="notice feed-notice" aria-live="polite">
        {notice}
      </p>
      <Items detail={detail} onSaved={onSaved} />
      <Unsubscribe
        confirming={confirmingUnsubscribe}
        working={unsubscribing}
        onConfirm={onConfirmUnsubscribe}
        onUnsubscribe={onUnsubscribe}
      />
    </>
  )
}

/**
 * Leaving a Feed, said plainly before it happens: checking stops and the
 * Digest lets go, while everything saved stays in the Library. Two quiet
 * words rather than a warning dialog — the consequence sentence is the
 * confirmation step.
 */
function Unsubscribe({
  confirming,
  working,
  onConfirm,
  onUnsubscribe,
}: {
  confirming: boolean
  working: boolean
  onConfirm: (confirming: boolean) => void
  onUnsubscribe: () => void
}) {
  if (!confirming) {
    return (
      <p className="unsubscribe-controls">
        <button className="text-button unsubscribe-open" type="button" onClick={() => onConfirm(true)}>
          unsubscribe from this feed
        </button>
      </p>
    )
  }
  return (
    <div className="unsubscribe-controls">
      <p className="unsubscribe-consequences">
        this stops checking the feed and its items leave the digest — anything saved stays in your library
      </p>
      <p className="unsubscribe-choice">
        <button className="text-button" type="button" disabled={working} onClick={onUnsubscribe}>
          {working ? 'unsubscribing…' : 'unsubscribe'}
        </button>
        <button className="text-button" type="button" disabled={working} onClick={() => onConfirm(false)}>
          keep subscribed
        </button>
      </p>
    </div>
  )
}

function Grid({
  grid,
  title,
  onShowDay,
}: {
  grid: CadenceGrid
  title: string
  onShowDay: (date: string) => void
}) {
  return (
    <div className="cadence-figure">
      <div className="cadence-grid" role="group" aria-label={`26 weeks of publishing cadence for ${title}`}>
        {grid.columns.flatMap((column) =>
          column.cells.map((cell) =>
            cell.count > 0 ? (
              <button
                key={cell.date}
                type="button"
                className="cadence-cell"
                data-level={cell.level}
                aria-label={`${cadenceDayLabel(cell)} — show that day`}
                onClick={() => onShowDay(cell.date)}
              />
            ) : (
              <span key={cell.date} className="cadence-cell" data-level={0} aria-hidden="true" />
            ),
          ),
        )}
      </div>
      <div className="cadence-months" aria-hidden="true">
        {grid.columns.map((column, index) =>
          column.monthLabel ? (
            <span key={column.cells[0]?.date ?? index} className="cadence-month" style={{ '--column': index } as CSSProperties}>
              {column.monthLabel}
            </span>
          ) : null,
        )}
      </div>
    </div>
  )
}

/**
 * The same calm sentence the list shows. The retry it offers there is this
 * screen's own refresh control, sitting just below.
 */
function AvailabilityNote({ detail }: { detail: FeedDetail }) {
  const { availability } = detail
  if (availability.state !== 'unavailable') return null

  const reason = availability.category ? AVAILABILITY_COPY[availability.category] : 'checking is not working'
  const lastSuccess = availability.lastSuccessAt
    ? `last reached ${noteDate(availability.lastSuccessAt)}`
    : 'not reached since subscribing'

  return (
    <p className="availability-note">
      <span>
        {reason} — {lastSuccess}. its items stay in your digest.
      </span>
    </p>
  )
}

function Items({
  detail,
  onSaved,
}: {
  detail: FeedDetail
  onSaved: (feedItemId: number, saved: boolean) => void
}) {
  if (detail.items.length === 0) {
    return <p className="empty-note feed-items-state">nothing retained from this feed yet</p>
  }

  // The first Feed Item of each day anchors that day, so a selected grid cell
  // has somewhere to move focus. No source labels: everything here is this Feed.
  const anchored = new Set<string>()
  return (
    <div className="content-list feed-items">
      {detail.items.map((item) => {
        const anchors = !anchored.has(item.date)
        anchored.add(item.date)
        return (
          <article
            className="content-item"
            key={item.feedItemId}
            {...(anchors ? { id: dayAnchor(detail.feedId, item.date), tabIndex: -1 } : {})}
          >
            <h2 className="content-item-title">{item.title}</h2>
            <div className="content-meta">
              <time dateTime={item.publishedAt ?? item.firstSeenAt}>{item.displayDate}</time>
              <SaveToggle
                feedItemId={item.feedItemId}
                title={item.title}
                saved={item.saved}
                onSaved={(saved) => onSaved(item.feedItemId, saved)}
              />
            </div>
          </article>
        )
      })}
    </div>
  )
}

function dayAnchor(feedId: number, date: string): string {
  return `feed-${feedId}-day-${date}`
}

function intervalPhrase(minutes: PollingIntervalMinutes): string {
  return minutes === 1440 ? 'daily' : `every ${INTERVAL_WORDS[minutes]}`
}

const INTERVAL_WORDS: Readonly<Record<PollingIntervalMinutes, string>> = {
  30: '30 min',
  60: 'hour',
  120: '2 hours',
  360: '6 hours',
  720: '12 hours',
  1440: 'daily',
}
