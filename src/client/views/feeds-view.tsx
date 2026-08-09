import { useEffect, useState, type ChangeEvent, type FormEvent } from 'react'
import type { OpmlImportFeed, OpmlImportReport, SubscriptionSummary } from '../../shared/api.js'
import { ApiError, fetchSubscriptions, importOpml, refreshFeed, subscribeToFeed } from '../api.js'
import { cadenceLevel } from '../cadence.js'
import { feedPathOf } from '../routing.js'
import { AVAILABILITY_COPY, noteDate, retryFailure, subscriptionFailure } from './feed-language.js'

type SubscriptionState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'loaded'; readonly subscriptions: readonly SubscriptionSummary[] }
  | { readonly kind: 'unavailable' }

export interface FeedsViewProps {
  /** Told when the Owner opens one Feed from the list. */
  onOpenFeed(feedId: number): void
}

export function FeedsView({ onOpenFeed }: FeedsViewProps) {
  const [state, setState] = useState<SubscriptionState>({ kind: 'loading' })
  const [query, setQuery] = useState('')
  const [notice, setNotice] = useState('')
  const [subscribing, setSubscribing] = useState(false)
  const [importing, setImporting] = useState(false)
  const [report, setReport] = useState<OpmlImportReport | undefined>(undefined)
  const [retryingFeedId, setRetryingFeedId] = useState<number | undefined>(undefined)

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

  /**
   * One control searches and adds. Typing narrows the list; a line that is an
   * exact Feed URL subscribes on enter, which is the only thing a URL can
   * usefully mean here.
   */
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const url = feedUrlOf(query)
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
      setQuery('')
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

  /**
   * The manual retry behind an unavailable Feed's note. Whatever the attempt
   * finds, the list is refetched so the row reports the newest state.
   */
  async function retry(feedId: number) {
    if (retryingFeedId !== undefined) return
    setRetryingFeedId(feedId)
    setNotice('')
    try {
      await refreshFeed(feedId)
      setNotice('the feed answered — availability restored')
    } catch (error) {
      setNotice(retryFailure(error))
    } finally {
      setRetryingFeedId(undefined)
    }
    try {
      const { subscriptions } = await fetchSubscriptions()
      setState({ kind: 'loaded', subscriptions })
    } catch {
      // The retry outcome is already on screen; a failed refetch changes nothing.
    }
  }

  return (
    <div className="view measure feeds-view">
      <form className="feed-search" onSubmit={submit}>
        <input
          className="field-input feed-search-input"
          type="text"
          inputMode="url"
          autoComplete="off"
          spellCheck={false}
          aria-label="search or add feeds"
          placeholder="search or add feeds"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
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
        {subscribing ? 'subscribing…' : notice}
      </p>
      <ImportReport report={report} />
      <SubscriptionList
        state={state}
        query={query}
        retryingFeedId={retryingFeedId}
        onRetry={retry}
        onOpen={onOpenFeed}
      />
    </div>
  )
}

/** The entered line, when it is an exact Feed URL rather than a search. */
function feedUrlOf(query: string): string | undefined {
  const line = query.trim()
  return /^https?:\/\/\S+$/i.test(line) ? line : undefined
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

function SubscriptionList({
  state,
  query,
  retryingFeedId,
  onRetry,
  onOpen,
}: {
  state: SubscriptionState
  query: string
  retryingFeedId: number | undefined
  onRetry: (feedId: number) => void
  onOpen: (feedId: number) => void
}) {
  if (state.kind === 'loading') return <p className="empty-note subscription-list-state">loading feeds</p>
  if (state.kind === 'unavailable') return <p className="empty-note subscription-list-state">feeds are unavailable</p>
  if (state.subscriptions.length === 0) return <p className="empty-note subscription-list-state">no subscriptions yet</p>

  const shown = state.subscriptions.filter((subscription) => matches(subscription, query))
  if (shown.length === 0) return <p className="empty-note subscription-list-state">no feeds match</p>

  return (
    <div className="content-list subscription-list" aria-label="Subscriptions">
      {shown.map((subscription) => (
        <article className="content-item feed-row" key={subscription.feedId}>
          <div className="feed-row-main">
            <h2 className="content-item-title">
              <a
                className="feed-open"
                href={feedPathOf(subscription.feedId)}
                onClick={(event) => {
                  // Let the browser handle anything that is not a plain left click.
                  if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) {
                    return
                  }
                  event.preventDefault()
                  onOpen(subscription.feedId)
                }}
              >
                {subscription.title}
              </a>
            </h2>
            <CadenceStrip counts={subscription.cadence} title={subscription.title} />
          </div>
          <div className="content-meta">
            <span>{subscription.domain}</span>
          </div>
          <AvailabilityNote
            subscription={subscription}
            retrying={retryingFeedId === subscription.feedId}
            onRetry={onRetry}
          />
        </article>
      ))}
    </div>
  )
}

/** A search narrows by what the row shows: the Feed's name and its domain. */
function matches(subscription: SubscriptionSummary, query: string): boolean {
  const line = query.trim().toLowerCase()
  if (!line || line.startsWith('http://') || line.startsWith('https://')) return true
  return (
    subscription.title.toLowerCase().includes(line) || subscription.domain.toLowerCase().includes(line)
  )
}

/**
 * The calm face of a failing Feed. It appears only once checking has failed
 * three times in a row, states what is known — never the raw error — and
 * offers a retry rather than suggesting the Subscription be removed.
 */
function AvailabilityNote({
  subscription,
  retrying,
  onRetry,
}: {
  subscription: SubscriptionSummary
  retrying: boolean
  onRetry: (feedId: number) => void
}) {
  const { availability } = subscription
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
      <button
        className="text-button availability-retry"
        type="button"
        disabled={retrying}
        onClick={() => onRetry(subscription.feedId)}
      >
        {retrying ? 'retrying…' : 'retry now'}
      </button>
    </p>
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
