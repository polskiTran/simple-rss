import { Button } from '@base-ui/react/button'
import { useEffect, useEffectEvent, useState, type FormEvent } from 'react'
import type { FeedDetail, OpmlImportReport, SubscriptionSummary } from '../../shared/api.js'
import { ApiError, fetchFeedDetail, fetchSubscriptions, refreshFeed, subscribeToFeed } from '../api.js'
import { CadenceStrip } from '../components/cadence-strip.js'
import { HomePageLink } from '../components/home-page-link.js'
import { LoadingNote } from '../components/loading-note.js'
import { routedClick } from '../routed-link.js'
import { feedPathOf } from '../routing.js'
import { type Resource, useResource } from '../use-resource.js'
import { firstCheckFailure, retryFailure, subscriptionFailure, unavailableNote } from './feed-language.js'
import { ImportReport, OpmlControls, type OpmlImportOutcome } from './opml-controls.js'

const FIRST_CHECK_ATTEMPTS = 8
const FIRST_CHECK_INTERVAL_MS = 2_000

const UNCHECKED_REFRESH_MS = 3_000
const UNCHECKED_REFRESH_ROUNDS = 20

export interface FeedsViewProps {
  onOpenFeed(feedId: number): void
}

export function FeedsView({ onOpenFeed }: FeedsViewProps) {
  const [state, { retry: reload, set }] = useResource(
    async (signal) => (await fetchSubscriptions(signal)).subscriptions,
    [],
  )
  const [address, setAddress] = useState('')
  const [notice, setNotice] = useState('')
  const [subscribing, setSubscribing] = useState(false)
  const [report, setReport] = useState<OpmlImportReport | undefined>(undefined)
  const [retryingFeedId, setRetryingFeedId] = useState<number | undefined>(undefined)
  const [refreshRound, setRefreshRound] = useState(0)

  async function refreshList(): Promise<void> {
    if (state.kind !== 'loaded') {
      reload()
      return
    }
    try {
      const { subscriptions } = await fetchSubscriptions()
      set(() => subscriptions)
    } catch {}
  }

  const pollUnchecked = useEffectEvent(async () => {
    await refreshList()
    setRefreshRound((round) => round + 1)
  })

  useEffect(() => {
    if (state.kind !== 'loaded' || refreshRound >= UNCHECKED_REFRESH_ROUNDS) return
    if (!state.value.some((subscription) => subscription.availability.state === 'unchecked')) return
    const timer = window.setTimeout(pollUnchecked, UNCHECKED_REFRESH_MS)
    return () => window.clearTimeout(timer)
  }, [state, refreshRound])

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (subscribing) return
    const url = feedUrlOf(address)
    if (!url) {
      if (address.trim()) setNotice('a feed is added by its url — paste the full https:// address')
      return
    }

    setSubscribing(true)
    setNotice('subscribing…')
    try {
      const created = await subscribeToFeed(url)
      await refreshList()
      setAddress('')
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
    await refreshList()
  }

  return (
    <div className="view measure feeds-view">
      <form className="add-feed-form" onSubmit={submit}>
        <input
          className="field-input search-input"
          type="text"
          inputMode="url"
          autoComplete="off"
          spellCheck={false}
          aria-label="add a feed by url"
          placeholder="add a feed by url"
          value={address}
          onChange={(event) => setAddress(event.target.value)}
        />
      </form>
      <OpmlControls onOutcome={imported} />
      <p className="notice feed-notice" aria-live="polite">
        {notice}
      </p>
      <ImportReport report={report} />
      <SubscriptionList state={state} retryingFeedId={retryingFeedId} onRetry={retry} onOpen={onOpenFeed} />
    </div>
  )
}

function feedUrlOf(address: string): string | undefined {
  const line = address.trim()
  return /^https?:\/\/\S+$/i.test(line) ? line : undefined
}

async function watchFirstCheck(feedId: number): Promise<string> {
  for (let attempt = 0; attempt < FIRST_CHECK_ATTEMPTS; attempt += 1) {
    if (attempt > 0) await wait(FIRST_CHECK_INTERVAL_MS)
    let detail: FeedDetail
    try {
      detail = await fetchFeedDetail(feedId)
    } catch (error) {
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

function SubscriptionList({
  state,
  retryingFeedId,
  onRetry,
  onOpen,
}: {
  state: Resource<readonly SubscriptionSummary[]>
  retryingFeedId: number | undefined
  onRetry: (feedId: number) => void
  onOpen: (feedId: number) => void
}) {
  if (state.kind === 'loading')
    return <LoadingNote className="empty-note subscription-list-state">loading feeds</LoadingNote>
  if (state.kind !== 'loaded') return <p className="empty-note subscription-list-state">feeds are unavailable</p>
  if (state.value.length === 0) return <p className="empty-note subscription-list-state">no subscriptions yet</p>

  return (
    <div className="content-list subscription-list" role="region" aria-label="Subscriptions">
      {state.value.map((subscription) => (
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
