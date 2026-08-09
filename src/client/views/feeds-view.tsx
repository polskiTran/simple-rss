import { useEffect, useState, type ChangeEvent, type FormEvent } from 'react'
import type { OpmlImportFeed, OpmlImportReport, SubscriptionSummary } from '../../shared/api.js'
import { ApiError, fetchSubscriptions, importOpml, subscribeToFeed } from '../api.js'

type SubscriptionState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'loaded'; readonly subscriptions: readonly SubscriptionSummary[] }
  | { readonly kind: 'unavailable' }

export function FeedsView() {
  const [state, setState] = useState<SubscriptionState>({ kind: 'loading' })
  const [url, setUrl] = useState('')
  const [notice, setNotice] = useState('')
  const [subscribing, setSubscribing] = useState(false)
  const [importing, setImporting] = useState(false)
  const [report, setReport] = useState<OpmlImportReport | undefined>(undefined)

  useEffect(() => {
    let active = true
    void fetchSubscriptions()
      .then(({ subscriptions }) => {
        if (!active) return
        setState((current) => {
          if (current.kind !== 'loaded') return { kind: 'loaded', subscriptions }
          const merged = new Map(current.subscriptions.map((subscription) => [subscription.feedId, subscription]))
          for (const subscription of subscriptions) {
            if (!merged.has(subscription.feedId)) merged.set(subscription.feedId, subscription)
          }
          return { kind: 'loaded', subscriptions: [...merged.values()] }
        })
      })
      .catch(() => {
        if (active) setState((current) => (current.kind === 'loaded' ? current : { kind: 'unavailable' }))
      })
    return () => {
      active = false
    }
  }, [])

  async function subscribe(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!url || subscribing) return

    setSubscribing(true)
    setNotice('')
    try {
      const created = await subscribeToFeed(url)
      setState((current) => {
        if (current.kind !== 'loaded') return { kind: 'loaded', subscriptions: [created.subscription] }
        if (current.subscriptions.some((subscription) => subscription.feedId === created.subscription.feedId)) {
          return current
        }
        return { kind: 'loaded', subscriptions: [...current.subscriptions, created.subscription] }
      })
      setUrl('')
      setNotice(
        created.importedItems === 1
          ? 'subscribed — 1 item added to the digest'
          : `subscribed — ${created.importedItems} items added to the digest`,
      )
    } catch (error) {
      setNotice(subscriptionFailure(error))
    } finally {
      setSubscribing(false)
    }
  }

  async function importFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    // Cleared so choosing the same file again fires another change event.
    event.target.value = ''
    if (!file || importing) return

    setImporting(true)
    setNotice('')
    setReport(undefined)
    try {
      const imported = await importOpml(await readFileText(file))
      setReport(imported)
      const { subscriptions } = await fetchSubscriptions()
      setState({ kind: 'loaded', subscriptions })
    } catch (error) {
      setNotice(importFailure(error))
    } finally {
      setImporting(false)
    }
  }

  return (
    <div className="view measure feeds-view">
      <form className="feed-form" onSubmit={subscribe}>
        <label className="field feed-url-field">
          <span className="field-label">exact RSS or Atom URL</span>
          <input
            className="field-input"
            type="url"
            inputMode="url"
            autoComplete="url"
            spellCheck={false}
            value={url}
            onChange={(event) => setUrl(event.target.value)}
          />
        </label>
        <button className="text-button subscribe-button" type="submit" disabled={subscribing || !url}>
          {subscribing ? 'subscribing…' : 'subscribe'}
        </button>
      </form>
      <div className="opml-controls">
        <label className="opml-import">
          <span>{importing ? 'importing…' : 'import OPML'}</span>
          <input
            className="opml-file-input"
            type="file"
            accept=".opml,.xml,text/x-opml,text/xml,application/xml"
            disabled={importing}
            onChange={importFile}
          />
        </label>
        <a className="opml-export" href="/api/subscriptions/export" download="subscriptions.opml">
          export OPML
        </a>
      </div>
      <p className="notice feed-notice" aria-live="polite">
        {notice}
      </p>
      <ImportReport report={report} />
      <SubscriptionList state={state} />
    </div>
  )
}

function readFileText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error ?? new Error('The file could not be read'))
    reader.readAsText(file)
  })
}

/**
 * What one import did, Feed by Feed. Added Feeds appear in the list itself,
 * so only the skipped and failed ones need a line of their own.
 */
function ImportReport({ report }: { report: OpmlImportReport | undefined }) {
  if (!report) return null
  if (report.feeds.length === 0) {
    return <p className="notice import-report-summary">that OPML file lists no feeds</p>
  }

  const counted = (outcome: OpmlImportFeed['outcome']) =>
    report.feeds.filter((feed) => feed.outcome === outcome).length
  const explained = report.feeds.filter((feed) => feed.outcome !== 'added')

  return (
    <div className="import-report" aria-live="polite">
      <p className="notice import-report-summary">
        {`imported — ${counted('added')} added, ${counted('skipped')} skipped, ${counted('failed')} failed`}
      </p>
      {explained.length > 0 ? (
        <ul className="import-report-details">
          {explained.map((feed) => (
            <li key={feed.url}>
              {feed.title ?? feed.url} — {(feed.reason ?? 'not added').toLowerCase()}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}

function SubscriptionList({ state }: { state: SubscriptionState }) {
  if (state.kind === 'loading') return <p className="empty-note subscription-list-state">loading feeds</p>
  if (state.kind === 'unavailable') return <p className="empty-note subscription-list-state">feeds are unavailable</p>
  if (state.subscriptions.length === 0) return <p className="empty-note subscription-list-state">no subscriptions yet</p>

  return (
    <div className="content-list subscription-list" aria-label="Subscriptions">
      {state.subscriptions.map((subscription) => (
        <article className="content-item feed-row" key={subscription.feedId}>
          <div className="feed-row-main">
            <h2 className="content-item-title">{subscription.title}</h2>
            <CadenceStrip counts={subscription.cadence} title={subscription.title} />
          </div>
          <div className="content-meta">
            <span>{subscription.domain}</span>
          </div>
        </article>
      ))}
    </div>
  )
}

function CadenceStrip({ counts, title }: { counts: readonly number[]; title: string }) {
  const total = counts.reduce((sum, count) => sum + count, 0)
  return (
    <span className="cadence-strip" role="img" aria-label={`${total} items from ${title} in the last 30 days`}>
      {counts.map((count, index) => (
        <span className="cadence-day" data-level={cadenceLevel(count)} key={index} aria-hidden="true" />
      ))}
    </span>
  )
}

function cadenceLevel(count: number): 0 | 1 | 2 | 3 | 4 {
  if (count === 0) return 0
  if (count === 1) return 1
  if (count <= 3) return 2
  if (count <= 7) return 3
  return 4
}

const SUBSCRIPTION_FAILURE_COPY: Readonly<Record<string, string>> = {
  duplicate_subscription: 'already subscribed',
  invalid_feed_url: 'enter an exact RSS or Atom URL',
  feed_too_large: 'that Feed is larger than 2 MiB',
  unsupported_feed: 'that URL does not return supported RSS or Atom',
  malformed_feed: 'that Feed contains malformed XML',
  feed_timeout: 'that Feed took too long to respond',
  feed_unreachable: 'that Feed could not be reached',
}

function subscriptionFailure(error: unknown): string {
  if (!(error instanceof ApiError)) return 'the Feed could not be reached'
  return SUBSCRIPTION_FAILURE_COPY[error.code] ?? 'that Feed could not be added'
}

const IMPORT_FAILURE_COPY: Readonly<Record<string, string>> = {
  malformed_opml: 'that file is malformed XML',
  unsupported_opml: 'that file is not an OPML subscription list',
  too_many_feeds: 'that file lists more feeds than one import can process',
  invalid_request: 'that file is too large to import',
}

function importFailure(error: unknown): string {
  if (!(error instanceof ApiError)) return 'the reader is unavailable'
  return IMPORT_FAILURE_COPY[error.code] ?? 'that file could not be imported'
}
