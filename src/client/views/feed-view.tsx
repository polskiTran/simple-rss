import { useEffect, useState, type CSSProperties } from 'react'
import {
  POLLING_INTERVAL_PRESETS,
  type FeedDetail,
  type PollingIntervalMinutes,
} from '../../shared/api.js'
import { ApiError, fetchFeedDetail, refreshFeed, unsubscribeFromFeed, updatePollingInterval } from '../api.js'
import { cadenceDayLabel, cadenceGrid, type CadenceGrid } from '../cadence.js'
import { BackLink } from '../components/back-link.js'
import { HomePageLink } from '../components/home-page-link.js'
import { ItemTitleLink } from '../components/item-title-link.js'
import { LoadingNote } from '../components/loading-note.js'
import { SaveToggle } from '../components/save-toggle.js'
import type { Origin } from '../routing.js'
import { AVAILABILITY_COPY, noteDate, retryFailure } from './feed-language.js'

type DetailState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'loaded'; readonly detail: FeedDetail }
  | { readonly kind: 'missing' }
  | { readonly kind: 'unavailable' }

export interface FeedViewProps {
  readonly feedId: number
  readonly origin: Origin
  onBack(origin: Origin): void
  /** Not the way back: that can point at an article of the Feed just left. */
  onUnsubscribed(): void
  /** `feedTitle` rides along so the Reader's way back can name this Feed. */
  onOpenItem(feedItemId: number, feedTitle: string): void
}

export function FeedView({ feedId, origin, onBack, onUnsubscribed, onOpenItem }: FeedViewProps) {
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

  // Doubles as the retry when the Feed is unavailable; the detail is
  // refetched whatever the attempt finds.
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

  // Success leaves for the Feeds list: this screen describes a Subscription
  // that no longer exists.
  async function unsubscribe() {
    if (unsubscribing) return
    setUnsubscribing(true)
    setNotice('')
    try {
      await unsubscribeFromFeed(feedId)
      onUnsubscribed()
    } catch {
      setNotice('the feed could not be unsubscribed')
      setUnsubscribing(false)
      setConfirmingUnsubscribe(false)
    }
  }

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

  function showDay(date: string) {
    const day = document.getElementById(dayAnchor(feedId, date))
    if (!day) return
    day.focus({ preventScroll: true })
    // Quieted by hand: browsers do not quiet their own smooth scrolling under
    // `prefers-reduced-motion`.
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
    day.scrollIntoView?.({ block: 'start', behavior: reduceMotion ? 'auto' : 'smooth' })
  }

  return (
    <div className="view measure feed-view">
      <p className="feed-header">
        <BackLink className="feed-back" origin={origin} onBack={onBack} />
        {state.kind === 'loaded' ? (
          <>
            <span className="feed-header-title">{state.detail.title}</span>
            <HomePageLink
              className="feed-header-domain"
              domain={state.detail.domain}
              homePageUrl={state.detail.homePageUrl}
            />
          </>
        ) : null}
      </p>
      {state.kind === 'loading' ? (
        <LoadingNote className="empty-note feed-detail-state">loading the feed</LoadingNote>
      ) : null}
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
          onOpenItem={onOpenItem}
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
  onOpenItem,
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
  onOpenItem: (feedItemId: number, feedTitle: string) => void
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
        <span className="feed-actions">
          <button className="text-button feed-refresh" type="button" disabled={refreshing} onClick={onRefresh}>
            {refreshing ? 'refreshing…' : 'refresh now'}
          </button>
          <button
            className="text-button unsubscribe-open"
            type="button"
            aria-expanded={confirmingUnsubscribe}
            aria-controls="unsubscribe-confirmation"
            onClick={() => onConfirmUnsubscribe(!confirmingUnsubscribe)}
          >
            unsubscribe…
          </button>
        </span>
      </div>
      {confirmingUnsubscribe ? (
        <Unsubscribe working={unsubscribing} onConfirm={onConfirmUnsubscribe} onUnsubscribe={onUnsubscribe} />
      ) : null}
      <p className="notice feed-notice" aria-live="polite">
        {notice}
      </p>
      <Items detail={detail} onSaved={onSaved} onOpenItem={onOpenItem} />
    </>
  )
}

// Unfolds under the controls that opened it — quiet words rather than a
// warning dialog, with the consequence sentence as the confirmation step.
function Unsubscribe({
  working,
  onConfirm,
  onUnsubscribe,
}: {
  working: boolean
  onConfirm: (confirming: boolean) => void
  onUnsubscribe: () => void
}) {
  return (
    // The grid row opens from nothing on mount, so the content below arrives
    // rather than teleports.
    <div className="unsubscribe-reveal">
      <div className="unsubscribe-controls" id="unsubscribe-confirmation">
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

// Same sentence as the list's note. No retry button: this screen's refresh
// control just below is the retry.
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
  onOpenItem,
}: {
  detail: FeedDetail
  onSaved: (feedItemId: number, saved: boolean) => void
  onOpenItem: (feedItemId: number, feedTitle: string) => void
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
            <h2 className="content-item-title">
              <ItemTitleLink
                feedItemId={item.feedItemId}
                title={item.title}
                onOpen={(feedItemId) => onOpenItem(feedItemId, detail.title)}
              />
            </h2>
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
