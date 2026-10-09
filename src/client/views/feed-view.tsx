import { Button } from '@base-ui/react/button'
import { useState, useTransition } from 'react'
import {
  MAX_FEED_DESCRIPTION_LENGTH,
  MAX_FEED_TITLE_LENGTH,
  POLLING_INTERVAL_MINUTES,
  type FeedDetail,
  type FeedDetailsUpdate,
  type PollingIntervalMinutes,
  type ReadingSource,
} from '../../shared/api.js'
import {
  ApiError,
  fetchFeedDetail,
  refreshFeed,
  unsubscribeFromFeed,
  updateFeedDetails,
  updatePollingInterval,
  updateReadingSource,
} from '../api.js'
import { useScreenTitle } from '../arrival.js'
import { cadenceGrid } from '../cadence.js'
import { ActionDialog, DialogCancel } from '../components/action-dialog.js'
import { BackButton } from '../components/back-button.js'
import { CadenceGrid } from '../components/cadence-grid.js'
import { Choice } from '../components/choice.js'
import { Field } from '../components/field.js'
import { enterSection, Group } from '../components/group.js'
import { HomePageLink } from '../components/home-page-link.js'
import { Icon } from '../components/icon.js'
import { ItemBox } from '../components/item-box.js'
import { LoadFailure } from '../components/load-failure.js'
import { LoadingNote } from '../components/loading-note.js'
import { NativeSelect } from '../components/native-select.js'
import { Row } from '../components/row.js'
import { withSaved } from '../components/save-toggle.js'
import { counted, dayOfYear, dayTitle, longDay } from '../day-names.js'
import { READING_SOURCE_LABELS, READING_SOURCE_OPTIONS } from '../reading-source.js'
import type { Origin } from '../routing.js'
import { useResource, valueInView } from '../use-resource.js'
import { retryFailure, unavailableNote } from './feed-language.js'

interface FeedViewProps {
  readonly feedId: number
  readonly origin: Origin
  onBack(origin: Origin): void
  /** Not the way back: that can point at an article of the Feed just left. */
  onUnsubscribed(): void
  /** `feedTitle` rides along so the Reader's way back can name this Feed. */
  onOpenItem(feedItemId: number, feedTitle: string): void
}

export function FeedView({ feedId, origin, onBack, onUnsubscribed, onOpenItem }: FeedViewProps) {
  const [state, { retry, set }] = useResource(String(feedId), (signal) => fetchFeedDetail(feedId, signal))
  const inView = valueInView(state)
  // While another Feed loads, the one it replaces is not this Feed's to show.
  const detail = inView?.feedId === feedId ? inView : undefined
  useScreenTitle(detail?.title)
  const [notice, setNotice] = useState('')
  const [refreshing, startRefresh] = useTransition()
  const [changing, startChange] = useTransition()

  // Each action clears the notice before its transition starts, so the clearing
  // shows at once and an answer repeated word for word is announced again.
  function refresh() {
    if (refreshing) return
    setNotice('')
    startRefresh(async () => {
      try {
        const { observedItems } = await refreshFeed(feedId)
        setNotice(`Refreshed. The feed shows ${counted(observedItems, 'item')}.`)
      } catch (error) {
        setNotice(retryFailure(error))
      }
      // Read again in place: the detail stays in view, and a Feed opened meanwhile cancels it.
      retry()
    })
  }

  function changeInterval(pollingIntervalMinutes: PollingIntervalMinutes) {
    if (changing) return
    setNotice('')
    startChange(async () => {
      try {
        const schedule = await updatePollingInterval(feedId, pollingIntervalMinutes)
        set((detail) => ({ ...detail, schedule }))
        setNotice(`Now checked ${INTERVALS[pollingIntervalMinutes].phrase}.`)
      } catch {
        setNotice('The interval couldn’t be changed.')
      }
    })
  }

  function changeReadingSource(readingSource: ReadingSource) {
    if (changing) return
    setNotice('')
    startChange(async () => {
      try {
        const preference = await updateReadingSource(feedId, readingSource)
        set((detail) => ({ ...detail, ...preference }))
        setNotice(`Items now open with the ${READING_SOURCE_LABELS[readingSource].toLowerCase()}.`)
      } catch {
        setNotice('The reading source couldn’t be changed.')
      }
    })
  }

  const back = <BackButton className="view-back" origin={origin} onBack={onBack} />

  if (!detail) {
    if (state.kind === 'unavailable' || state.kind === 'unreachable') {
      const missing = state.error instanceof ApiError && state.error.status === 404
      return (
        <div className="view">
          <div className="view-topline">{back}</div>
          {missing ? (
            <p className="note">That feed isn’t among your subscriptions.</p>
          ) : (
            <LoadFailure subject="The feed" kind={state.kind} onRetry={retry} />
          )}
        </div>
      )
    }
    return (
      <div className="view">
        <div className="view-topline">{back}</div>
        <LoadingNote>Loading the feed</LoadingNote>
      </div>
    )
  }

  const grid = cadenceGrid(detail.cadence)
  // The Cadence runs through today.
  const today = detail.cadence.at(-1)?.date ?? detail.subscribedDate
  return (
    <div className="view">
      <div className="view-topline">{back}</div>
      <header className="feed-head">
        <div className="feed-identity">
          <h1 className="page-title">{detail.title}</h1>
          {detail.description ? <p className="feed-description">{detail.description}</p> : null}
          <HomePageLink domain={detail.domain} homePageUrl={detail.homePageUrl} />
        </div>
        <div className="toolbar-group feed-actions">
          <EditFeed detail={detail} onSaved={(details) => set((current) => ({ ...current, ...details }))} />
          <Button className="button" focusableWhenDisabled disabled={refreshing} onClick={refresh}>
            <Icon name="refresh" />
            {refreshing ? 'Refreshing…' : 'Refresh now'}
          </Button>
          <Unsubscribe
            feedId={feedId}
            feedTitle={detail.title}
            onUnsubscribed={onUnsubscribed}
            onFailed={() => setNotice('The feed couldn’t be unsubscribed.')}
          />
        </div>
      </header>

      <div className="feed-notices" aria-live="polite">
        {detail.availability.state === 'unavailable' ? (
          <p className="note">{unavailableNote(detail.availability)}</p>
        ) : null}
        <p className="note">{notice}</p>
      </div>

      <div className="feed-panels">
        <Group id="feed-cadence" title="Cadence" className="panel">
          <CadenceGrid grid={grid} title={detail.title} onShowDay={(date) => enterSection(dayAnchor(feedId, date))} />
        </Group>
        <Group id="feed-info" title="Info" className="panel">
          <dl className="rows">
            <Row label="Subscribed" value={dayOfYear(detail.subscribedDate, today)} />
            <Row label="Items, last 26 weeks" value={grid.stats.total.toLocaleString('en-GB')} />
            <Row label="Busiest day" value={grid.stats.busiestWeekday ?? 'None yet'} />
            <Row
              label="Longest quiet stretch"
              value={grid.stats.longestQuiet === 0 ? 'None' : counted(grid.stats.longestQuiet, 'day')}
            />
            <Row
              label="Last checked"
              value={detail.availability.lastCheckedAt ? ago(detail.availability.lastCheckedAt) : 'Not yet'}
            />
          </dl>
        </Group>
        <Group id="feed-settings" title="Settings" className="panel">
          <div className="rows">
            <div className="row">
              <span className="row-label">Check every</span>
              <NativeSelect
                label="Check every"
                value={String(detail.schedule.pollingIntervalMinutes)}
                options={POLLING_INTERVAL_MINUTES.map((minutes) => ({
                  value: String(minutes),
                  label: INTERVALS[minutes].label,
                }))}
                disabled={changing}
                onChange={(chosen) => {
                  const minutes = POLLING_INTERVAL_MINUTES.find((offered) => String(offered) === chosen)
                  if (minutes !== undefined) changeInterval(minutes)
                }}
              />
            </div>
            <div className="row">
              <span className="row-label">Open items with</span>
              <Choice
                label="Open items with"
                options={READING_SOURCE_OPTIONS}
                value={detail.readingSource}
                onChange={changeReadingSource}
              />
            </div>
          </div>
        </Group>
      </div>

      <Items
        detail={detail}
        onSaved={(feedItemId, saved) =>
          set((current) => ({ ...current, items: withSaved(current.items, feedItemId, saved) }))
        }
        onOpenItem={onOpenItem}
      />
    </div>
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
    return <p className="note feed-items-state">Nothing retained from this feed yet.</p>
  }

  // The Cadence runs through today; every retained item arrives at once, so
  // each day's count is whole.
  const today = detail.cadence.at(-1)?.date
  const days = Map.groupBy(detail.items, (item) => item.date)
  return (
    <div className="feed-items">
      {[...days].map(([date, items]) => (
        <Group
          key={date}
          id={dayAnchor(detail.feedId, date)}
          title={today ? dayTitle(date, today) : longDay(date)}
          count={items.length}
        >
          <div className="item-list">
            {items.map((item) => (
              <ItemBox
                key={item.feedItemId}
                feedItemId={item.feedItemId}
                title={item.title}
                saved={item.saved}
                when={{ label: item.displayTime, dateTime: item.publishedAt ?? item.firstSeenAt }}
                onOpen={(feedItemId) => onOpenItem(feedItemId, detail.title)}
                onSaved={(saved) => onSaved(item.feedItemId, saved)}
              />
            ))}
          </div>
        </Group>
      ))}
    </div>
  )
}

function EditFeed({ detail, onSaved }: { detail: FeedDetail; onSaved: (details: FeedDetailsUpdate) => void }) {
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [saving, startSaving] = useTransition()
  const [error, setError] = useState('')

  function openChanged(next: boolean) {
    if (saving) return
    setOpen(next)
    if (next) {
      setTitle(detail.customTitle ?? '')
      setDescription(detail.customDescription ?? '')
      setError('')
    }
  }

  function save() {
    if (saving) return
    setError('')
    startSaving(async () => {
      try {
        onSaved(
          await updateFeedDetails(detail.feedId, {
            customTitle: overrideOf(title),
            customDescription: overrideOf(description),
          }),
        )
        setOpen(false)
      } catch {
        setError('The changes couldn’t be saved.')
      }
    })
  }

  const changed = overrideOf(title) !== detail.customTitle || overrideOf(description) !== detail.customDescription
  return (
    <ActionDialog
      open={open}
      title="Edit feed"
      trigger={
        <Button className="button">
          <Icon name="pencil" />
          Edit
        </Button>
      }
      onOpenChange={openChanged}
    >
      <form
        className="dialog-body"
        onSubmit={(event) => {
          event.preventDefault()
          save()
        }}
      >
        <Field
          label="Name"
          value={title}
          placeholder={detail.reportedTitle}
          maxLength={MAX_FEED_TITLE_LENGTH}
          note={`Shown in your digest and feeds. The feed calls itself ${detail.reportedTitle}.`}
          onChange={setTitle}
        />
        <Field
          label="Description"
          value={description}
          placeholder={detail.reportedDescription ?? undefined}
          maxLength={MAX_FEED_DESCRIPTION_LENGTH}
          multiline
          note="Shown on this page. Left blank, the feed’s own description stands."
          onChange={setDescription}
        />
        <p className="note note-error" role="status">
          {error}
        </p>
        <div className="dialog-footer">
          <DialogCancel disabled={saving} />
          <Button className="button button-primary" type="submit" focusableWhenDisabled disabled={!changed || saving}>
            {saving ? 'Saving…' : 'Save changes'}
          </Button>
        </div>
      </form>
    </ActionDialog>
  )
}

function Unsubscribe({
  feedId,
  feedTitle,
  onUnsubscribed,
  onFailed,
}: {
  feedId: number
  feedTitle: string
  onUnsubscribed: () => void
  onFailed: () => void
}) {
  const [open, setOpen] = useState(false)
  const [working, startWorking] = useTransition()

  function unsubscribe() {
    if (working) return
    startWorking(async () => {
      try {
        await unsubscribeFromFeed(feedId)
        onUnsubscribed()
      } catch {
        setOpen(false)
        onFailed()
      }
    })
  }

  return (
    <ActionDialog
      open={open}
      title={`Unsubscribe from ${feedTitle}?`}
      description="Its items leave your digest. Saved items stay in Saved."
      trigger={<Button className="button button-danger">Unsubscribe</Button>}
      onOpenChange={(next) => {
        if (!working) setOpen(next)
      }}
    >
      <div className="dialog-footer">
        <DialogCancel disabled={working} />
        <Button className="button button-danger" focusableWhenDisabled disabled={working} onClick={unsubscribe}>
          {working ? 'Unsubscribing…' : 'Unsubscribe'}
        </Button>
      </div>
    </ActionDialog>
  )
}

function dayAnchor(feedId: number, date: string): string {
  return `feed-${feedId}-day-${date}`
}

function overrideOf(draft: string): string | null {
  const trimmed = draft.trim()
  return trimmed === '' ? null : trimmed
}

/** `12 minutes ago`, `Yesterday` — how long since an instant, in its largest whole unit. */
function ago(iso: string): string {
  const seconds = (Date.parse(iso) - Date.now()) / 1000
  const format = new Intl.RelativeTimeFormat('en-GB', { numeric: 'auto' })
  const [unit, size] = AGO_UNITS.find(([, span]) => Math.abs(seconds) >= span) ?? ['second', 1]
  const phrase = format.format(Math.round(seconds / size), unit)
  return phrase.charAt(0).toUpperCase() + phrase.slice(1)
}

const AGO_UNITS = [
  ['day', 86_400],
  ['hour', 3_600],
  ['minute', 60],
  ['second', 1],
] as const satisfies readonly (readonly [Intl.RelativeTimeFormatUnit, number])[]

/** Each Polling Interval as the select names it, and as the notice says it is now checked. */
const INTERVALS = {
  30: { label: '30 minutes', phrase: 'every 30 minutes' },
  60: { label: '1 hour', phrase: 'every hour' },
  120: { label: '2 hours', phrase: 'every 2 hours' },
  360: { label: '6 hours', phrase: 'every 6 hours' },
  720: { label: '12 hours', phrase: 'every 12 hours' },
  1440: { label: '1 day', phrase: 'once a day' },
} as const satisfies Readonly<Record<PollingIntervalMinutes, { label: string; phrase: string }>>
