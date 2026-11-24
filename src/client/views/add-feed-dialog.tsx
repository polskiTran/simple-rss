import { Button } from '@base-ui/react/button'
import { Radio } from '@base-ui/react/radio'
import { RadioGroup } from '@base-ui/react/radio-group'
import { useId, useState, useTransition, type FormEvent, type KeyboardEvent } from 'react'
import type { CreateSubscriptionResponse, FeedPreview, OpmlImportReport } from '../../shared/api.js'
import { RHYTHM_LABELS, rhythmOf } from '../../shared/rhythm.js'
import { importOpml } from '../api.js'
import { ActionDialog, DialogCancel } from '../components/action-dialog.js'
import { CadenceStrip } from '../components/cadence-strip.js'
import { Choice } from '../components/choice.js'
import { Field } from '../components/field.js'
import { Icon } from '../components/icon.js'
import { LoadingNote } from '../components/loading-note.js'
import { ago, daysBefore, relativeDay, shortDate } from '../day-names.js'
import { importFailure, useFeedLookup } from './feed-lookup.js'

type Way = 'address' | 'opml'

const SILENT_AFTER_DAYS = 90

interface AddFeedDialogProps {
  onSubscribed(created: CreateSubscriptionResponse): void
  onImported(report: OpmlImportReport): void
}

export function AddFeedDialog({ onSubscribed, onImported }: AddFeedDialogProps) {
  const [open, setOpen] = useState(false)
  const [way, setWay] = useState<Way>('address')
  const [file, setFile] = useState<File | undefined>(undefined)
  const [error, setError] = useState<string | undefined>(undefined)
  const [importing, startImporting] = useTransition()
  const adding = useFeedLookup({
    active: open && way === 'address',
    onSubscribed(created) {
      onSubscribed(created)
      setOpen(false)
    },
  })

  function openChanged(next: boolean) {
    if (importing) return
    setOpen(next)
    adding.reset()
    if (next) {
      setFile(undefined)
      setError(undefined)
    }
  }

  function keyDown(event: KeyboardEvent) {
    if (way !== 'address' || event.key !== 'Enter' || event.nativeEvent.isComposing) return
    if (!(event.target instanceof HTMLInputElement)) return
    event.preventDefault()
    adding.proceed()
  }

  function submit(event: FormEvent) {
    event.preventDefault()
    if (way === 'address') {
      adding.proceed()
      return
    }

    if (importing || !file) return

    setError(undefined)
    startImporting(async () => {
      try {
        const report = await importOpml(await file.text())
        setOpen(false)
        onImported(report)
      } catch (cause) {
        setError(importFailure(cause))
      }
    })
  }

  const { lookup, answer, subscribing, failure } = adding
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
          disabled={importing || subscribing}
          onChange={(next) => {
            setWay(next)
            setError(undefined)
            adding.stop()
          }}
        />
        {way === 'address' ? (
          <>
            <Field
              label="URL"
              type="url"
              value={adding.address}
              placeholder="https://"
              autoComplete="off"
              autoFocus
              readOnly={subscribing}
              error={adding.refusal}
              onChange={adding.changeAddress}
            />
            <div className="add-feed-result" aria-live="polite">
              {lookup.kind === 'reading' ? <LoadingNote>{`Reading ${lookup.host}`}</LoadingNote> : null}
              {answer ? (
                <FoundFeeds
                  host={answer.host}
                  feeds={answer.feeds}
                  chosen={answer.chosen}
                  readOnly={subscribing}
                  onChoose={adding.choose}
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
            {error ? (
              <p className="field-note field-error" role="alert">
                {error}
              </p>
            ) : null}
          </div>
        )}
        <div className="dialog-footer">
          <DialogCancel disabled={importing} />
          {way === 'opml' ? (
            <Button
              className="button button-primary"
              type="submit"
              focusableWhenDisabled
              disabled={!file || importing}
              aria-busy={importing}
            >
              {importing ? 'Importing…' : 'Import'}
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
              disabled={!answer || answer.chosen.subscribed || subscribing}
              aria-busy={subscribing}
            >
              {answer?.chosen.subscribed ? 'Already subscribed' : subscribing ? 'Subscribing…' : 'Subscribe'}
            </Button>
          )}
        </div>
      </form>
    </ActionDialog>
  )
}

function FoundFeeds({
  host,
  feeds,
  chosen,
  readOnly,
  onChoose,
}: {
  host: string
  feeds: readonly FeedPreview[]
  chosen: FeedPreview
  readOnly: boolean
  onChoose(feed: FeedPreview): void
}) {
  const id = useId()

  if (feeds.length === 1) {
    return (
      <div className="add-feed-found feed-preview" data-lone="">
        <FeedHead feed={chosen} id={id} />
        <FeedDetail feed={chosen} />
      </div>
    )
  }

  return (
    <div className="add-feed-found">
      <p className="feed-choices-lede" id={`${id}-lede`}>
        {host} names {feeds.length.toLocaleString('en-GB')} feeds
      </p>
      <RadioGroup
        className="feed-choices"
        aria-labelledby={`${id}-lede`}
        value={chosen.feedUrl}
        readOnly={readOnly}
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
                <FeedHead feed={feed} id={feedId} />
              </Radio.Root>
              {open ? <FeedDetail feed={feed} /> : null}
            </div>
          )
        })}
      </RadioGroup>
    </div>
  )
}

function isSilent({ lastItemDate, today }: FeedPreview): boolean {
  return lastItemDate === null || daysBefore(lastItemDate, today) > SILENT_AFTER_DAYS
}

function FeedHead({ feed, id }: { feed: FeedPreview; id: string }) {
  const { lastItemDate, today } = feed
  return (
    <span className="feed-preview-head">
      <span className="feed-preview-name" id={`${id}-name`}>
        {feed.title}
      </span>
      <CadenceStrip counts={feed.cadence} title={feed.title} />
      <span className="feed-preview-pulse" id={`${id}-pulse`}>
        <span className={isSilent(feed) ? 'feed-preview-mark' : undefined}>
          {lastItemDate === null ? 'No items' : `Last item ${ago(lastItemDate, today)}`}
        </span>
        <span>{RHYTHM_LABELS[rhythmOf(feed.cadence)]}</span>
        {feed.subscribed ? <span className="feed-preview-mark">You follow this</span> : null}
      </span>
    </span>
  )
}

function FeedDetail({ feed: { items, today, feedUrl } }: { feed: FeedPreview }) {
  return (
    <div className="feed-preview-detail">
      {items.length > 0 ? (
        <ol className="feed-preview-items">
          {items.map(({ title, date }, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: the newest titles in Feed order; two may share a title, and the list never reorders while shown.
            <li key={index} className="feed-preview-item">
              <span className="feed-preview-title">{title}</span>
              <span className="feed-preview-day">{relativeDay(date, today) ?? shortDate(date, today)}</span>
            </li>
          ))}
        </ol>
      ) : null}
      <p className="feed-preview-url">{feedUrl.replace(/^https:\/\//, '')}</p>
    </div>
  )
}
