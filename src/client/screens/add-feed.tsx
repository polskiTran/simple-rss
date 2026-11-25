import { Button } from '@base-ui/react/button'
import { useEffect, useId, useRef, useState, useTransition } from 'react'
import type { CreateSubscriptionResponse, FeedPreview, OpmlImportReport } from '../../shared/api.js'
import { RHYTHM_LABELS, rhythmOf } from '../../shared/rhythm.js'
import { importOpml } from '../api.js'
import { ago, counted } from '../day-names.js'
import { importFailure, useFeedLookup } from '../feed-lookup.js'
import { LedgerRow, Options } from '../components/ledger.js'

const PREVIEW_TITLES = 4

export function AddFeedRows({
  focused,
  onSubscribed,
  onImported,
}: {
  readonly focused: boolean
  onSubscribed(created: CreateSubscriptionResponse): void
  onImported(): void
}) {
  const adding = useFeedLookup({ active: true, onSubscribed })
  const { lookup, answer, failure } = adding
  const [importing, startImporting] = useTransition()
  const [imported, setImported] = useState('')
  const field = useRef<HTMLInputElement>(null)
  const addressId = useId()
  useEffect(() => {
    if (focused) field.current?.focus()
  }, [focused])

  const importFile = (file: File) => {
    if (importing) return
    setImported('')
    startImporting(async () => {
      try {
        const report = await importOpml(await file.text())
        setImported(importNote(report))
        onImported()
      } catch (cause) {
        setImported(importFailure(cause))
      }
    })
  }

  return (
    <>
      <LedgerRow label={<label htmlFor={addressId}>Add a Feed</label>}>
        <form
          onSubmit={(event) => {
            event.preventDefault()
            adding.proceed()
          }}
        >
          <input
            ref={field}
            id={addressId}
            className="x-search"
            type="url"
            placeholder="Site or Feed address"
            autoComplete="off"
            spellCheck={false}
            enterKeyHint="go"
            readOnly={adding.subscribing}
            value={adding.address}
            onChange={(event) => adding.changeAddress(event.target.value)}
          />
        </form>
        <div className="x-add" aria-live="polite">
          {lookup.kind === 'reading' ? <p className="x-grey">Reading {lookup.host}</p> : null}
          {adding.refusal ? <p>{adding.refusal}</p> : null}
          {failure?.retry ? (
            <Button className="x-action" onClick={adding.proceed}>
              Retry
            </Button>
          ) : null}
          {answer ? (
            <>
              {answer.feeds.length > 1 ? (
                <Options
                  label={`Feeds named by ${answer.host}`}
                  className="x-choices"
                  options={answer.feeds.map((feed) => ({ value: feed.feedUrl, label: feed.title }))}
                  value={answer.chosen.feedUrl}
                  onChange={(feedUrl) => {
                    const feed = answer.feeds.find((offered) => offered.feedUrl === feedUrl)
                    if (feed) adding.choose(feed)
                  }}
                />
              ) : null}
              <Preview feed={answer.chosen} named={answer.feeds.length === 1} />
              <Button
                className="x-action"
                focusableWhenDisabled
                disabled={adding.subscribing || answer.chosen.subscribed}
                aria-busy={adding.subscribing}
                onClick={adding.proceed}
              >
                {answer.chosen.subscribed
                  ? 'Already among your Subscriptions'
                  : adding.subscribing
                    ? 'Subscribing'
                    : `Subscribe to ${answer.chosen.title}`}
              </Button>
            </>
          ) : null}
        </div>
      </LedgerRow>
      <LedgerRow label="Import">
        <label className="x-action x-file" aria-busy={importing}>
          {importing ? 'Importing' : 'Import an OPML file'}
          <input
            className="visually-hidden"
            type="file"
            accept=".opml,.xml,text/x-opml,text/xml,application/xml"
            disabled={importing}
            onChange={(event) => {
              const [file] = event.target.files ?? []
              event.target.value = ''
              if (file) importFile(file)
            }}
          />
        </label>
        {imported ? (
          <p className="x-grey" role="status">
            {imported}
          </p>
        ) : null}
      </LedgerRow>
    </>
  )
}

function Preview({ feed, named }: { readonly feed: FeedPreview; readonly named: boolean }) {
  return (
    <div className="x-add-preview">
      {named ? <p className="x-add-name">{feed.title}</p> : null}
      <p className="x-grey">
        {RHYTHM_LABELS[rhythmOf(feed.cadence)]},{' '}
        {feed.lastItemDate === null ? 'no Feed Items yet' : `last Feed Item ${ago(feed.lastItemDate, feed.today)}`}
      </p>
      {feed.items.slice(0, PREVIEW_TITLES).map(({ title }, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: the newest titles in Feed order; two may share a title, and the list never reorders while shown.
        <p key={index} className="x-grey">
          {title}
        </p>
      ))}
    </div>
  )
}

function importNote({ added, alreadySubscribed, unusable }: OpmlImportReport): string {
  if (added === 0 && alreadySubscribed === 0 && unusable.length === 0) return 'That OPML file lists no Feeds.'
  const parts = [`Added ${counted(added, 'Feed')}`]
  if (alreadySubscribed > 0) parts.push(`${alreadySubscribed.toLocaleString('en-GB')} already followed`)
  if (unusable.length > 0) parts.push(`${unusable.length.toLocaleString('en-GB')} not usable`)
  return `${parts.join(', ')}.`
}
