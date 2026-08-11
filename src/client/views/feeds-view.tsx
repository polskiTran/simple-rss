import { useEffect, useState, type ChangeEvent, type FormEvent } from 'react'
import type { OpmlImportReport, SubscriptionSummary } from '../../shared/api.js'
import { ApiError, fetchFeedDetail, fetchSubscriptions, importOpml, refreshFeed, subscribeToFeed } from '../api.js'
import { cadenceLevel } from '../cadence.js'
import { LoadingNote } from '../components/loading-note.js'
import { routedClick } from '../routed-link.js'
import { feedPathOf } from '../routing.js'
import { AVAILABILITY_COPY, firstCheckFailure, noteDate, retryFailure, subscriptionFailure } from './feed-language.js'

/** How the subscribe watch paces itself: a look now, then every two seconds. */
const FIRST_CHECK_ATTEMPTS = 8
const FIRST_CHECK_INTERVAL_MS = 2_000

/** How the list keeps up while unchecked Subscriptions resolve in background. */
const UNCHECKED_REFRESH_MS = 3_000
const UNCHECKED_REFRESH_ROUNDS = 20

type SubscriptionState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'loaded'; readonly subscriptions: readonly SubscriptionSummary[] }
  | { readonly kind: 'unavailable' }

export interface FeedsViewProps {
  /** Told when the User opens one Feed from the list. */
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
  const [refreshRound, setRefreshRound] = useState(0)

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

  async function refreshList(): Promise<void> {
    try {
      const { subscriptions } = await fetchSubscriptions()
      setState({ kind: 'loaded', subscriptions })
    } catch {
      // The list already on screen is better than an unavailable note.
    }
  }

  // While any Subscription waits for its first check, the list keeps up with
  // the background retrievals for a while — bounded, so a Feed that stays
  // unchecked ends with a quiet note rather than polling forever.
  useEffect(() => {
    if (state.kind !== 'loaded' || refreshRound >= UNCHECKED_REFRESH_ROUNDS) return
    if (!state.subscriptions.some((subscription) => subscription.availability.state === 'unchecked')) return
    const timer = window.setTimeout(async () => {
      await refreshList()
      setRefreshRound((round) => round + 1)
    }, UNCHECKED_REFRESH_MS)
    return () => window.clearTimeout(timer)
  }, [state, refreshRound])

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
    setNotice('subscribing…')
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
      setNotice('subscribed — checking the feed…')
      setRefreshRound(0)
      setNotice(await watchFirstCheck(created.subscription.feedId))
      await refreshList()
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
      setRefreshRound(0)
      await refreshList()
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
      <form className="search-form" onSubmit={submit}>
        <input
          className="field-input search-input"
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
        <a className="export-link" href="/api/subscriptions/export" download="subscriptions.opml">
          export OPML
        </a>
      </div>
      <p className="notice feed-notice" aria-live="polite">
        {notice}
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

/**
 * Watches a fresh Subscription for its first check, so a mistyped URL is
 * caught in the same breath (ADR 0007). The server never waits for this —
 * after the watch gives up, the list's availability note takes over.
 */
async function watchFirstCheck(feedId: number): Promise<string> {
  for (let attempt = 0; attempt < FIRST_CHECK_ATTEMPTS; attempt += 1) {
    if (attempt > 0) await wait(FIRST_CHECK_INTERVAL_MS)
    let detail
    try {
      detail = await fetchFeedDetail(feedId)
    } catch (error) {
      // Gone already: the first retrieval revealed an already-subscribed Feed
      // and this Subscription quietly folded into it.
      if (error instanceof ApiError && error.status === 404) return 'already subscribed'
      continue
    }
    if (detail.availability.lastSuccessAt) {
      return detail.items.length === 1
        ? 'subscribed — 1 item in the digest'
        : `subscribed — ${detail.items.length} items in the digest`
    }
    if (detail.availability.consecutiveFailures > 0) {
      return firstCheckFailure(detail.availability.category)
    }
  }
  return 'still checking — the feed will appear in the list'
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
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
 * What one import recorded. The counts are the whole story the server can
 * tell — whether each Feed answers shows up on the list as its first check
 * lands — so only outlines that could not become Subscriptions get a line.
 */
function ImportReport({ report }: { report: OpmlImportReport | undefined }) {
  if (!report) return null
  if (report.added === 0 && report.alreadySubscribed === 0 && report.unusable.length === 0) {
    return <p className="notice import-report-summary">that OPML file lists no feeds</p>
  }

  return (
    <div className="import-report" aria-live="polite">
      <p className="notice import-report-summary">
        {`imported — ${report.added} added, ${report.alreadySubscribed} already subscribed`}
      </p>
      {report.unusable.length > 0 ? (
        <ul className="import-report-details">
          {report.unusable.map((url) => (
            <li key={url}>{url} — not a usable feed url</li>
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
  if (state.kind === 'loading')
    return <LoadingNote className="empty-note subscription-list-state">loading feeds</LoadingNote>
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
                onClick={routedClick(() => onOpen(subscription.feedId))}
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
  if (availability.state === 'unchecked') {
    return <p className="availability-note">waiting for first check</p>
  }
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
