import { useEffect, useState, type FormEvent } from 'react'
import type { SubscriptionSummary } from '../../shared/api.js'
import { ApiError, fetchSubscriptions, subscribeToFeed } from '../api.js'

type SubscriptionState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'loaded'; readonly subscriptions: readonly SubscriptionSummary[] }
  | { readonly kind: 'unavailable' }

export function FeedsView() {
  const [state, setState] = useState<SubscriptionState>({ kind: 'loading' })
  const [url, setUrl] = useState('')
  const [notice, setNotice] = useState('')
  const [subscribing, setSubscribing] = useState(false)

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
      <p className="notice feed-notice" aria-live="polite">
        {notice}
      </p>
      <SubscriptionList state={state} />
    </div>
  )
}

function SubscriptionList({ state }: { state: SubscriptionState }) {
  if (state.kind === 'loading') return <p className="empty-note feed-list-state">loading feeds</p>
  if (state.kind === 'unavailable') return <p className="empty-note feed-list-state">feeds are unavailable</p>
  if (state.subscriptions.length === 0) return <p className="empty-note feed-list-state">no subscriptions yet</p>

  return (
    <div className="content-list feed-list" aria-label="Subscriptions">
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

function subscriptionFailure(error: unknown): string {
  if (!(error instanceof ApiError)) return 'the Feed could not be reached'
  switch (error.code) {
    case 'duplicate_subscription':
      return 'already subscribed'
    case 'invalid_feed_url':
      return 'enter an exact, reachable RSS or Atom URL'
    case 'feed_too_large':
      return 'that Feed is larger than 2 MiB'
    case 'unsupported_feed':
      return 'that URL does not return supported RSS or Atom'
    case 'malformed_feed':
      return 'that Feed contains malformed XML'
    case 'feed_timeout':
      return 'that Feed took too long to respond'
    case 'feed_unreachable':
      return 'that Feed could not be reached'
    default:
      return 'that Feed could not be added'
  }
}
