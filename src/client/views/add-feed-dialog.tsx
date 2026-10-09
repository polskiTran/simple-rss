import { Button } from '@base-ui/react/button'
import { useState, type FormEvent } from 'react'
import type { ApiErrorCode, CreateSubscriptionResponse, OpmlImportReport } from '../../shared/api.js'
import { hasOwn } from '../../shared/record.js'
import { ApiError, importOpml, subscribeToFeed } from '../api.js'
import { ActionDialog, DialogCancel } from '../components/action-dialog.js'
import { Choice } from '../components/choice.js'
import { Field } from '../components/field.js'
import { Icon } from '../components/icon.js'
import { feedAddressOf, subscriptionFailure } from './feed-language.js'

type Way = 'address' | 'opml'

export interface AddFeedDialogProps {
  /** A Subscription was recorded; the page takes over watching its first check. */
  onSubscribed(created: CreateSubscriptionResponse): void
  onImported(report: OpmlImportReport): void
}

/**
 * Adding by a site or feed address, or by an OPML file. A refusal stays in the
 * dialog beside what caused it; a success closes it and the page reports on.
 */
export function AddFeedDialog({ onSubscribed, onImported }: AddFeedDialogProps) {
  const [open, setOpen] = useState(false)
  const [way, setWay] = useState<Way>('address')
  const [address, setAddress] = useState('')
  const [file, setFile] = useState<File | undefined>(undefined)
  const [error, setError] = useState<string | undefined>(undefined)
  const [working, setWorking] = useState(false)

  function openChanged(next: boolean) {
    if (working) return
    setOpen(next)
    if (next) {
      setAddress('')
      setFile(undefined)
      setError(undefined)
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (working) return
    setError(undefined)

    if (way === 'address') {
      const url = feedAddressOf(address)
      if (!url) {
        setError('Enter a site or feed address, like lowtechmagazine.com.')
        return
      }
      setWorking(true)
      try {
        const created = await subscribeToFeed(url)
        setOpen(false)
        onSubscribed(created)
      } catch (cause) {
        setError(subscriptionFailure(cause))
      } finally {
        setWorking(false)
      }
      return
    }

    if (!file) return
    setWorking(true)
    try {
      const report = await importOpml(await file.text())
      setOpen(false)
      onImported(report)
    } catch (cause) {
      setError(importFailure(cause))
    } finally {
      setWorking(false)
    }
  }

  const ready = way === 'address' ? address.trim() !== '' : file !== undefined
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
      <form className="dialog-body" onSubmit={submit}>
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
          }}
        />
        {way === 'address' ? (
          <Field
            label="URL"
            type="url"
            value={address}
            placeholder="https://"
            autoComplete="off"
            autoFocus
            note="A site address is enough; simple finds the feed."
            error={error}
            onChange={setAddress}
          />
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
          <Button className="button button-primary" type="submit" focusableWhenDisabled disabled={!ready || working}>
            {way === 'address' ? (working ? 'Subscribing…' : 'Subscribe') : working ? 'Importing…' : 'Import'}
          </Button>
        </div>
      </form>
    </ActionDialog>
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
