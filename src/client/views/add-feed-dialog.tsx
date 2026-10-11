import { Button } from '@base-ui/react/button'
import { Radio } from '@base-ui/react/radio'
import { RadioGroup } from '@base-ui/react/radio-group'
import {
  useEffect,
  useEffectEvent,
  useId,
  useRef,
  useState,
  useTransition,
  type FormEvent,
  type KeyboardEvent,
} from 'react'
import type {
  ApiErrorCode,
  CreateSubscriptionResponse,
  FeedPreview,
  FeedPreviewResponse,
  OpmlImportReport,
} from '../../shared/api.js'
import { hasOwn } from '../../shared/record.js'
import { RHYTHM_LABELS, rhythmOf } from '../../shared/rhythm.js'
import { ApiError, importOpml, previewFeed, subscribeToFeed } from '../api.js'
import { ActionDialog, DialogCancel } from '../components/action-dialog.js'
import { CadenceStrip } from '../components/cadence-strip.js'
import { Choice } from '../components/choice.js'
import { Field } from '../components/field.js'
import { Icon } from '../components/icon.js'
import { LoadingNote } from '../components/loading-note.js'
import { ago, daysBefore, lapse, localDay, relativeDay, shortDate } from '../day-names.js'
import { addFailure, feedAddressOf, NOT_AN_ADDRESS } from './feed-language.js'

type Way = 'address' | 'opml'

/** How long typing pauses before the address is looked up; a paste or Enter goes at once. */
const LOOKUP_PAUSE_MS = 800

/** A Feed with no item for longer than this is said to be silent: it may have stopped publishing. */
const SILENT_AFTER_DAYS = 90

/**
 * Where the address's lookup stands. A found answer holds at least one Feed,
 * one of them chosen; a page that names none is a failure no retry can mend.
 */
type Lookup =
  | { readonly kind: 'idle' }
  | { readonly kind: 'reading'; readonly host: string }
  | {
      readonly kind: 'found'
      readonly host: string
      readonly feeds: readonly FeedPreview[]
      readonly chosen: FeedPreview
    }
  | { readonly kind: 'failed'; readonly reason: string; readonly retry: boolean }

const IDLE: Lookup = { kind: 'idle' }

interface AddFeedDialogProps {
  /** A checked Subscription was recorded; it arrives with the list it joins. */
  onSubscribed(created: CreateSubscriptionResponse): void
  onImported(report: OpmlImportReport): void
}

/**
 * Adding by a site or feed address, or by an OPML file. The address is looked
 * up as it is entered, and what it answers arrives under the field: the Feed,
 * or the Feeds a page names to choose from, each with how lately and how often
 * it publishes. Nothing is recorded until Subscribe; a refusal stays in the
 * dialog beside what caused it, and a success closes it.
 */
export function AddFeedDialog({ onSubscribed, onImported }: AddFeedDialogProps) {
  const [open, setOpen] = useState(false)
  const [way, setWay] = useState<Way>('address')
  const [address, setAddress] = useState('')
  const [lookup, setLookup] = useState<Lookup>(IDLE)
  const [file, setFile] = useState<File | undefined>(undefined)
  /** A refused Subscribe or Import. */
  const [error, setError] = useState<string | undefined>(undefined)
  const [working, startWorking] = useTransition()
  const inFlight = useRef<AbortController | undefined>(undefined)

  /** Abandons the lookup in flight, so its answer is never shown, and stands at `next`. */
  function settle(next: Lookup) {
    inFlight.current?.abort()
    inFlight.current = undefined
    setLookup(next)
  }

  async function lookUp(line: string) {
    setError(undefined)
    const url = feedAddressOf(line)
    if (!url) {
      settle({ kind: 'failed', reason: NOT_AN_ADDRESS, retry: false })
      return
    }
    const host = new URL(url).host
    settle({ kind: 'reading', host })
    const lookingUp = new AbortController()
    inFlight.current = lookingUp
    try {
      const preview = await previewFeed(url, lookingUp.signal)
      if (!lookingUp.signal.aborted) setLookup(found(preview, host))
    } catch (cause) {
      if (!lookingUp.signal.aborted) setLookup({ kind: 'failed', ...addFailure(cause, host) })
    }
  }

  // Typing looks up once it pauses on something that could be an address.
  const lookUpPaused = useEffectEvent((line: string) => void lookUp(line))
  useEffect(() => {
    if (!open || way !== 'address' || lookup.kind !== 'idle' || !feedAddressOf(address)) return
    const timer = window.setTimeout(() => lookUpPaused(address), LOOKUP_PAUSE_MS)
    return () => window.clearTimeout(timer)
  }, [open, way, address, lookup.kind])

  function openChanged(next: boolean) {
    if (working) return
    setOpen(next)
    settle(IDLE)
    if (next) {
      setAddress('')
      setFile(undefined)
      setError(undefined)
    }
  }

  /** What was found belongs to the old address; a paste is looked up at once. */
  function addressChanged(next: string) {
    const pasted = next.length - address.length > 1
    setAddress(next)
    setError(undefined)
    if (pasted && feedAddressOf(next)) void lookUp(next)
    else settle(IDLE)
  }

  function subscribe(feed: FeedPreview) {
    startWorking(async () => {
      try {
        const created = await subscribeToFeed(feed.feedUrl)
        setOpen(false)
        onSubscribed(created)
      } catch (cause) {
        setError(addFailure(cause, new URL(feed.feedUrl).host).reason)
      }
    })
  }

  /** Subscribes to the chosen Feed once there is one, and looks the address up otherwise. */
  function proceed() {
    if (working) return
    if (lookup.kind === 'found') {
      if (!lookup.chosen.subscribed) subscribe(lookup.chosen)
    } else if (lookup.kind !== 'reading') {
      void lookUp(address)
    }
  }

  // Enter in the field proceeds itself: a form submits on Enter only through
  // an enabled primary action, and Subscribe waits for a Feed to be chosen.
  function keyDown(event: KeyboardEvent) {
    if (way !== 'address' || event.key !== 'Enter' || event.nativeEvent.isComposing) return
    if (!(event.target instanceof HTMLInputElement)) return
    event.preventDefault()
    proceed()
  }

  function submit(event: FormEvent) {
    event.preventDefault()
    if (way === 'address') {
      proceed()
      return
    }

    if (working || !file) return

    setError(undefined)
    startWorking(async () => {
      try {
        const report = await importOpml(await file.text())
        setOpen(false)
        onImported(report)
      } catch (cause) {
        setError(importFailure(cause))
      }
    })
  }

  const chosen = lookup.kind === 'found' ? lookup.chosen : undefined
  const failure = lookup.kind === 'failed' ? lookup : undefined
  return (
    <ActionDialog
      open={open}
      title="Add feed"
      trigger={
        <Button className="button button-primary">
          <Icon name="plus" />
          Add feed
        </Button>
      }
      onOpenChange={openChanged}
    >
      <form className="dialog-body" onSubmit={submit} onKeyDown={keyDown}>
        <Choice
          label="How to add"
          className="add-feed-ways"
          options={[
            { value: 'address', label: 'Site or feed URL' },
            { value: 'opml', label: 'Import OPML' },
          ]}
          value={way}
          onChange={(next) => {
            setWay(next)
            setError(undefined)
            settle(IDLE)
          }}
        />
        {way === 'address' ? (
          <>
            <Field
              label="URL"
              type="url"
              value={address}
              placeholder="https://"
              autoComplete="off"
              autoFocus
              note="A site address is enough; simple finds its feeds."
              error={error ?? failure?.reason}
              onChange={addressChanged}
            />
            <div className="add-feed-result" aria-live="polite">
              {lookup.kind === 'reading' ? <LoadingNote>{`Reading ${lookup.host}`}</LoadingNote> : null}
              {lookup.kind === 'found' ? (
                <FoundFeeds
                  host={lookup.host}
                  feeds={lookup.feeds}
                  chosen={lookup.chosen}
                  onChoose={(feed) => {
                    setError(undefined)
                    setLookup({ ...lookup, chosen: feed })
                  }}
                />
              ) : null}
            </div>
          </>
        ) : (
          <div className="field">
            <span className="field-label">OPML file</span>
            <label className="button file-choice">
              <Icon name="upload" />
              {file ? file.name : 'Choose a file'}
              <input
                className="visually-hidden"
                type="file"
                accept=".opml,.xml,text/x-opml,text/xml,application/xml"
                onChange={(event) => {
                  setFile(event.target.files?.[0])
                  setError(undefined)
                }}
              />
            </label>
            <p className={error ? 'field-note field-error' : 'field-note'} role={error ? 'alert' : undefined}>
              {error ?? 'Records every feed the file lists; each is checked on its own schedule.'}
            </p>
          </div>
        )}
        <div className="dialog-footer">
          <DialogCancel disabled={working} />
          {way === 'opml' ? (
            <Button className="button button-primary" type="submit" focusableWhenDisabled disabled={!file || working}>
              {working ? 'Importing…' : 'Import'}
            </Button>
          ) : failure?.retry ? (
            <Button className="button button-primary" type="submit">
              Retry
            </Button>
          ) : (
            <Button
              className="button button-primary"
              type="submit"
              focusableWhenDisabled
              disabled={!chosen || chosen.subscribed || working}
            >
              {chosen?.subscribed ? 'Already subscribed' : working ? 'Subscribing…' : 'Subscribe'}
            </Button>
          )}
        </div>
      </form>
    </ActionDialog>
  )
}

/** A preview as the dialog holds it: a Feed alone, a page's Feeds with the first chosen, or the page's silence. */
function found(preview: FeedPreviewResponse, host: string): Lookup {
  if (preview.kind === 'feed') return { kind: 'found', host, feeds: [preview.feed], chosen: preview.feed }
  const [first] = preview.feeds
  if (!first) {
    return { kind: 'failed', reason: `${preview.host} doesn’t name a feed. Try the feed’s own address.`, retry: false }
  }
  return { kind: 'found', host: preview.host, feeds: preview.feeds, chosen: first }
}

/**
 * What the address answered. One Feed stands on its own; several are a choice,
 * one box each, and only the chosen one opens to its newest titles.
 */
function FoundFeeds({
  host,
  feeds,
  chosen,
  onChoose,
}: {
  host: string
  feeds: readonly FeedPreview[]
  chosen: FeedPreview
  onChoose(feed: FeedPreview): void
}) {
  const id = useId()
  const today = localDay(new Date())

  if (feeds.length === 1) {
    return (
      <div className="add-feed-found feed-preview" data-lone="">
        <FeedHead feed={chosen} today={today} id={id} />
        <FeedDetail feed={chosen} today={today} />
      </div>
    )
  }

  return (
    <div className="add-feed-found">
      <p className="feed-choices-lede" id={`${id}-lede`}>
        {host} names {feeds.length} feeds. Choose one.
      </p>
      <RadioGroup
        className="feed-choices"
        aria-labelledby={`${id}-lede`}
        value={chosen.feedUrl}
        onValueChange={(feedUrl) => {
          const next = feeds.find((feed) => feed.feedUrl === feedUrl)
          if (next) onChoose(next)
        }}
      >
        {feeds.map((feed, index) => {
          const feedId = `${id}-${index}`
          const open = feed === chosen
          return (
            <div key={feed.feedUrl} className="feed-preview feed-choice" data-chosen={open ? '' : undefined}>
              <Radio.Root
                className="feed-choice-head"
                value={feed.feedUrl}
                aria-labelledby={`${feedId}-name`}
                aria-describedby={`${feedId}-pulse`}
              >
                <FeedHead feed={feed} today={today} id={feedId} />
              </Radio.Root>
              {open ? <FeedDetail feed={feed} today={today} /> : null}
            </div>
          )
        })}
      </RadioGroup>
    </div>
  )
}

function lastDay(feed: FeedPreview): string | undefined {
  return feed.lastItemAt === null ? undefined : localDay(feed.lastItemAt)
}

function isSilent(lastItem: string | undefined, today: string): boolean {
  return lastItem === undefined || daysBefore(lastItem, today) > SILENT_AFTER_DAYS
}

/**
 * A Feed's name and Cadence, then its pulse: when it last published — in ink
 * once it has gone silent — its Rhythm, and whether it is already followed.
 */
function FeedHead({ feed, today, id }: { feed: FeedPreview; today: string; id: string }) {
  const lastItem = lastDay(feed)
  return (
    <span className="feed-preview-head">
      <span className="feed-preview-name" id={`${id}-name`}>
        {feed.title}
      </span>
      <CadenceStrip counts={feed.cadence} title={feed.title} />
      <span className="feed-preview-pulse" id={`${id}-pulse`}>
        <span className={isSilent(lastItem, today) ? 'feed-preview-mark' : undefined}>
          {lastItem === undefined ? 'No items' : `Last item ${ago(lastItem, today)}`}
        </span>
        <span>{RHYTHM_LABELS[rhythmOf(feed.cadence)]}</span>
        {feed.subscribed ? <span className="feed-preview-mark">You follow this</span> : null}
      </span>
    </span>
  )
}

/** An open Feed: a word on its silence, its newest titles with their days, and the address Subscribe sends. */
function FeedDetail({ feed, today }: { feed: FeedPreview; today: string }) {
  const lastItem = lastDay(feed)
  return (
    <div className="feed-preview-detail">
      {lastItem !== undefined && isSilent(lastItem, today) ? (
        <p className="feed-preview-warning">Nothing new in {lapse(lastItem, today)}. It may have stopped publishing.</p>
      ) : null}
      {feed.items.length > 0 ? (
        <ol className="feed-preview-items">
          {feed.items.map((item, index) => {
            const day = item.publishedAt === null ? undefined : localDay(item.publishedAt)
            return (
              // biome-ignore lint/suspicious/noArrayIndexKey: the newest titles in Feed order; two may share a title, and the list never reorders while shown.
              <li key={index} className="feed-preview-item">
                <span className="feed-preview-title">{item.title}</span>
                {day ? (
                  <span className="feed-preview-day">{relativeDay(day, today) ?? shortDate(day, today)}</span>
                ) : null}
              </li>
            )
          })}
        </ol>
      ) : null}
      <p className="feed-preview-url">{feed.feedUrl.replace(/^https:\/\//, '')}</p>
    </div>
  )
}

const IMPORT_FAILURE_COPY = {
  malformed_opml: 'That file is malformed XML.',
  unsupported_opml: 'That file isn’t an OPML subscription list.',
  too_many_feeds: 'That file lists more feeds than one import can take.',
  invalid_request: 'That file is too large to import.',
} as const satisfies Partial<Record<ApiErrorCode, string>>

function importFailure(cause: unknown): string {
  if (!(cause instanceof ApiError)) return 'The reader is unavailable.'
  const code = cause.code
  return hasOwn(IMPORT_FAILURE_COPY, code) ? IMPORT_FAILURE_COPY[code] : 'That file couldn’t be imported.'
}
