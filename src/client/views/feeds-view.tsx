import { Button } from '@base-ui/react/button'
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import type { OpmlImportReport, SubscriptionSummary } from '../../shared/api.js'
import { fetchSubscriptions, refreshFeed } from '../api.js'
import { cadenceLevel } from '../cadence.js'
import { HomePageLink } from '../components/home-page-link.js'
import { LoadingNote } from '../components/loading-note.js'
import { routedClick } from '../routed-link.js'
import { feedPathOf } from '../routing.js'
import { retryFailure, subscribedNotice, unavailableNote } from './feed-language.js'
import { ImportReport, OpmlControls, type OpmlImportOutcome } from './opml-controls.js'
import { PreviewDialog } from './preview-dialog.js'

const UNCHECKED_REFRESH_LADDER_MS = [3_000, 5_000] as const
const UNCHECKED_REFRESH_STEADY_MS = 10_000

type SubscriptionState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'loaded'; readonly subscriptions: readonly SubscriptionSummary[] }
  | { readonly kind: 'unavailable' }

export interface FeedsViewProps {
  onOpenFeed(feedId: number): void
}

export function FeedsView({ onOpenFeed }: FeedsViewProps) {
  const [state, setState] = useState<SubscriptionState>({ kind: 'loading' })
  const [query, setQuery] = useState('')
  const [notice, setNotice] = useState('')
  const [previewUrl, setPreviewUrl] = useState<string | undefined>(undefined)
  const field = useRef<HTMLInputElement>(null)
  const [report, setReport] = useState<OpmlImportReport | undefined>(undefined)
  const [retryingFeedId, setRetryingFeedId] = useState<number | undefined>(undefined)
  const [refreshRound, setRefreshRound] = useState(0)

  // Not `useResource`: this list is also written by subscribing, so the first load merges
  // into whatever landed while it was in flight rather than replacing it.
  useEffect(() => {
    const request = new AbortController()
    void fetchSubscriptions(request.signal)
      .then(({ subscriptions }) => {
        if (request.signal.aborted) return
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
        if (!request.signal.aborted) {
          setState((current) => (current.kind === 'loaded' ? current : { kind: 'unavailable' }))
        }
      })
    return () => request.abort()
  }, [])

  const refreshList = useCallback(async () => {
    try {
      const { subscriptions } = await fetchSubscriptions()
      setState({ kind: 'loaded', subscriptions })
    } catch {}
  }, [])

  useEffect(() => {
    if (state.kind !== 'loaded') return
    if (!state.subscriptions.some((subscription) => subscription.availability.state === 'unchecked')) return
    const timer = window.setTimeout(async () => {
      await refreshList()
      setRefreshRound((round) => round + 1)
    }, UNCHECKED_REFRESH_LADDER_MS[refreshRound] ?? UNCHECKED_REFRESH_STEADY_MS)
    return () => window.clearTimeout(timer)
  }, [state, refreshRound, refreshList])

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const url = feedUrlOf(query)
    if (!url || previewUrl !== undefined) return
    setNotice('')
    setPreviewUrl(url)
  }

  const closePreview = useCallback(() => setPreviewUrl(undefined), [])

  const previewFailed = useCallback((sentence: string) => {
    setNotice(sentence)
    setPreviewUrl(undefined)
  }, [])

  function subscribed(subscription: SubscriptionSummary, observedItems: number) {
    setState((current) => {
      if (current.kind !== 'loaded') return { kind: 'loaded', subscriptions: [subscription] }
      if (current.subscriptions.some((existing) => existing.feedId === subscription.feedId)) return current
      return { kind: 'loaded', subscriptions: [...current.subscriptions, subscription] }
    })
    setQuery('')
    setNotice(subscribedNotice(observedItems))
    setPreviewUrl(undefined)
  }

  function imported(outcome: OpmlImportOutcome) {
    switch (outcome.kind) {
      case 'started':
        setNotice('')
        setReport(undefined)
        return
      case 'failed':
        setNotice(outcome.notice)
        return
      case 'imported':
        setReport(outcome.report)
        setRefreshRound(0)
        void refreshList()
        return
    }
  }

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
    } catch {}
  }

  return (
    <div className="view measure feeds-view">
      <form className="search-form" onSubmit={submit}>
        <input
          ref={field}
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
      <PreviewDialog
        url={previewUrl}
        field={field}
        onClose={closePreview}
        onSubscribed={subscribed}
        onFailed={previewFailed}
        onOpenFeed={(feedId) => {
          setPreviewUrl(undefined)
          onOpenFeed(feedId)
        }}
      />
      <OpmlControls onOutcome={imported} />
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

function feedUrlOf(query: string): string | undefined {
  const line = query.trim()
  return /^https?:\/\/\S+$/i.test(line) ? line : undefined
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
  if (state.subscriptions.length === 0)
    return <p className="empty-note subscription-list-state">no subscriptions yet</p>

  const shown = state.subscriptions.filter((subscription) => matches(subscription, query))
  if (shown.length === 0) return <p className="empty-note subscription-list-state">no feeds match</p>

  return (
    <div className="content-list subscription-list" role="region" aria-label="Subscriptions">
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
            <HomePageLink domain={subscription.domain} homePageUrl={subscription.homePageUrl} />
          </div>
          <SubscriptionAvailability
            subscription={subscription}
            retrying={retryingFeedId === subscription.feedId}
            onRetry={onRetry}
          />
        </article>
      ))}
    </div>
  )
}

/** Matches the effective title, the effective description, and the domain. */
function matches(subscription: SubscriptionSummary, query: string): boolean {
  const line = query.trim().toLowerCase()
  if (!line || line.startsWith('http://') || line.startsWith('https://')) return true
  return (
    subscription.title.toLowerCase().includes(line) ||
    subscription.domain.toLowerCase().includes(line) ||
    (subscription.description?.toLowerCase().includes(line) ?? false)
  )
}

/** A row in the list also says when a Feed has never been checked, and offers the retry. */
function SubscriptionAvailability({
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

  return (
    <p className="availability-note">
      <span>{unavailableNote(availability)}</span>
      <Button
        className="text-button availability-retry"
        focusableWhenDisabled
        disabled={retrying}
        onClick={() => onRetry(subscription.feedId)}
      >
        {retrying ? 'retrying…' : 'retry now'}
      </Button>
    </p>
  )
}

function CadenceStrip({ counts, title }: { counts: readonly number[]; title: string }) {
  const total = counts.reduce((sum, count) => sum + count, 0)
  return (
    <span className="cadence-strip" role="img" aria-label={`${total} items from ${title} in the last 30 days`}>
      {counts.map((count, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: counts is a fixed window of consecutive days — the cell's position is the day it stands for.
        <span className="cadence-day" data-level={cadenceLevel(count)} key={index} aria-hidden="true" />
      ))}
    </span>
  )
}
