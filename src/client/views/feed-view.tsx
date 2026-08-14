import { Button } from '@base-ui/react/button'
import { Dialog } from '@base-ui/react/dialog'
import { Toggle } from '@base-ui/react/toggle'
import { ToggleGroup } from '@base-ui/react/toggle-group'
import { useState, type CSSProperties } from 'react'
import {
  POLLING_INTERVAL_MINUTES,
  type FeedAvailability,
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
import { useResource } from '../use-resource.js'
import { retryFailure, unavailableNote } from './feed-language.js'

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
  const [state, { set }] = useResource((signal) => fetchFeedDetail(feedId, signal), [feedId])
  const [notice, setNotice] = useState('')
  const [refreshing, setRefreshing] = useState(false)
  const [changingInterval, setChangingInterval] = useState(false)
  const [confirmingUnsubscribe, setConfirmingUnsubscribe] = useState(false)
  const [unsubscribing, setUnsubscribing] = useState(false)

  // A Feed the User is not subscribed to answers 404, which is a different note, not a failure.
  const missing = state.kind === 'unavailable' && state.error instanceof ApiError && state.error.status === 404
  const failed = state.kind === 'unavailable' || state.kind === 'unreachable'

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
      const detail = await fetchFeedDetail(feedId)
      set(() => detail)
    } catch {}
  }

  async function changeInterval(pollingIntervalMinutes: PollingIntervalMinutes) {
    if (changingInterval || state.kind !== 'loaded') return
    if (state.value.schedule.pollingIntervalMinutes === pollingIntervalMinutes) return
    setChangingInterval(true)
    setNotice('')
    try {
      const schedule = await updatePollingInterval(feedId, pollingIntervalMinutes)
      set((detail) => ({ ...detail, schedule }))
      setNotice(`now checked ${intervalPhrase(pollingIntervalMinutes)}`)
    } catch {
      setNotice('the interval could not be changed')
    } finally {
      setChangingInterval(false)
    }
  }

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
    set((detail) => ({
      ...detail,
      items: detail.items.map((item) => (item.feedItemId === feedItemId ? { ...item, saved } : item)),
    }))
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
            <span className="feed-header-title">{state.value.title}</span>
            <HomePageLink
              className="feed-header-domain"
              domain={state.value.domain}
              homePageUrl={state.value.homePageUrl}
            />
          </>
        ) : null}
      </p>
      {state.kind === 'loading' ? (
        <LoadingNote className="empty-note feed-detail-state">loading the feed</LoadingNote>
      ) : null}
      {missing ? <p className="empty-note feed-detail-state">that feed is not in your subscriptions</p> : null}
      {failed && !missing ? <p className="empty-note feed-detail-state">the feed is unavailable</p> : null}
      {state.kind === 'loaded' ? (
        <OpenFeed
          detail={state.value}
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
      <UnavailableNote availability={detail.availability} />
      <div className="feed-controls">
        <ToggleGroup
          className="interval-options"
          aria-label="checked every"
          value={[String(detail.schedule.pollingIntervalMinutes)]}
          onValueChange={(chosen) => {
            // Pressing the pressed word would empty the group; a Feed is always
            // checked on one of the six, so that press stays where it is.
            const minutes = POLLING_INTERVAL_MINUTES.find((offered) => String(offered) === chosen[0])
            if (minutes !== undefined) onChangeInterval(minutes)
          }}
        >
          <span className="interval-caption">checked every</span>
          {POLLING_INTERVAL_MINUTES.map((minutes) => (
            <Toggle
              key={minutes}
              className="text-button interval-option"
              value={String(minutes)}
              aria-label={`check ${intervalPhrase(minutes)}`}
            >
              {INTERVAL_WORDS[minutes]}
            </Toggle>
          ))}
        </ToggleGroup>
        <span className="feed-actions">
          <Button className="text-button feed-refresh" focusableWhenDisabled disabled={refreshing} onClick={onRefresh}>
            {refreshing ? 'refreshing…' : 'refresh now'}
          </Button>
          <Unsubscribe
            feedTitle={detail.title}
            confirming={confirmingUnsubscribe}
            working={unsubscribing}
            onConfirm={onConfirmUnsubscribe}
            onUnsubscribe={onUnsubscribe}
          />
        </span>
      </div>
      <p className="notice feed-notice" aria-live="polite">
        {notice}
      </p>
      <Items detail={detail} onSaved={onSaved} onOpenItem={onOpenItem} />
    </>
  )
}

/**
 * Unsubscribing is a decision to settle before anything else, so it is asked in
 * an overlay: focus trapped, escape and the dimmed backdrop both meaning keep.
 */
function Unsubscribe({
  feedTitle,
  confirming,
  working,
  onConfirm,
  onUnsubscribe,
}: {
  feedTitle: string
  confirming: boolean
  working: boolean
  onConfirm: (confirming: boolean) => void
  onUnsubscribe: () => void
}) {
  return (
    <Dialog.Root open={confirming} onOpenChange={onConfirm}>
      <Dialog.Trigger className="text-button unsubscribe-open">unsubscribe…</Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Backdrop className="overlay-backdrop" />
        <Dialog.Viewport className="overlay-viewport">
          <Dialog.Popup className="overlay-popup">
            <Dialog.Title className="overlay-title">unsubscribe from {feedTitle}</Dialog.Title>
            <Dialog.Description className="overlay-description">
              this stops checking the feed and its items leave the digest — anything saved stays in your library
            </Dialog.Description>
            <p className="unsubscribe-choice">
              <Button className="text-button" focusableWhenDisabled disabled={working} onClick={onUnsubscribe}>
                {working ? 'unsubscribing…' : 'unsubscribe'}
              </Button>
              <Dialog.Close className="text-button" disabled={working}>
                keep subscribed
              </Dialog.Close>
            </p>
          </Dialog.Popup>
        </Dialog.Viewport>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function Grid({ grid, title, onShowDay }: { grid: CadenceGrid; title: string; onShowDay: (date: string) => void }) {
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
            <span
              key={column.cells[0]?.date ?? index}
              className="cadence-month"
              style={{ '--column': index } as CSSProperties}
            >
              {column.monthLabel}
            </span>
          ) : null,
        )}
      </div>
    </div>
  )
}

/** An opened Feed says nothing while checking works, and nothing about a first check either. */
function UnavailableNote({ availability }: { availability: FeedAvailability }) {
  if (availability.state !== 'unavailable') return null

  return (
    <p className="availability-note">
      <span>{unavailableNote(availability)}</span>
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
