import { Button } from '@base-ui/react/button'
import { use, useEffect, useEffectEvent, useState, useTransition } from 'react'
import type { SubscriptionSummary } from '../../shared/api.js'
import { RHYTHM_LABELS, RHYTHMS, rhythmOf } from '../../shared/rhythm.js'
import { refreshFeed } from '../api.js'
import { useScreenTitle } from '../arrival.js'
import { counted } from '../day-names.js'
import { retryFailure, unavailableNote } from '../views/feed-language.js'
import { AddFeedRows } from './add-feed.js'
import { FeedRow, LedgerRow, SubscriptionsContext } from './parts.js'

const POLL_INTERVAL_MS = 2_000
const POLL_ROUNDS = 30

export function FeedsScreen({
  onOpenFeed,
  onSubscribed,
  onReload,
}: {
  onOpenFeed(feedId: number): void
  onSubscribed(feedId: number): void
  onReload(): void
}) {
  useScreenTitle('Feeds')
  const { list } = use(SubscriptionsContext)
  const [round, setRound] = useState(0)
  const [notice, setNotice] = useState('')
  const waiting = list?.some((feed) => feed.availability.state === 'unchecked') ?? false
  const poll = useEffectEvent(() => {
    setRound((done) => done + 1)
    onReload()
  })

  useEffect(() => {
    if (!waiting || round >= POLL_ROUNDS) return
    const timer = window.setTimeout(poll, POLL_INTERVAL_MS)
    return () => window.clearTimeout(timer)
  }, [waiting, round, list])

  const retry = async (feedId: number) => {
    setNotice('')
    try {
      await refreshFeed(feedId)
      setNotice('The Feed answered. Checking works again.')
    } catch (error) {
      setNotice(retryFailure(error))
    }
    onReload()
  }

  const tiers = RHYTHMS.flatMap((rhythm) => {
    const members = (list ?? [])
      .filter((feed) => rhythmOf(feed.cadence) === rhythm)
      .toSorted((left, right) => left.title.localeCompare(right.title))
    return members.length > 0 ? [{ rhythm, members }] : []
  })

  return (
    <div className="x-screen">
      <header className="x-ledger">
        <LedgerRow label={<h1 className="visually-hidden">Feeds</h1>}>
          {list === undefined ? (
            <span className="x-grey">Loading the Feeds</span>
          ) : list.length === 0 ? (
            'No Feeds yet.'
          ) : (
            counted(list.length, 'Subscription')
          )}
        </LedgerRow>
        <AddFeedRows
          focused={list?.length === 0}
          onSubscribed={({ subscription }) => onSubscribed(subscription.feedId)}
          onImported={() => {
            setRound(0)
            onReload()
          }}
        />
        <p className="x-grid x-notice" aria-live="polite">
          <span className="x-c-main">{notice}</span>
        </p>
      </header>

      {tiers.map(({ rhythm, members }) => (
        <section key={rhythm} className="x-day x-grid" aria-labelledby={`rhythm-${rhythm}`}>
          <h2 className="x-day-label x-tinted" id={`rhythm-${rhythm}`} data-rhythm={rhythm}>
            {RHYTHM_LABELS[rhythm]}
          </h2>
          <div className="x-rows">
            {members.map((feed) => (
              <FeedRow key={feed.feedId} feed={feed} onOpen={onOpenFeed}>
                <Availability feed={feed} onRetry={retry} />
              </FeedRow>
            ))}
          </div>
        </section>
      ))}

      {tiers.length > 0 ? (
        <div className="x-legend x-grid" aria-hidden="true">
          <span className="x-c-label">Rhythm</span>
          <span className="x-legend-title">Feed</span>
          <span className="x-legend-feed">Site</span>
          <span className="x-legend-time">30 days</span>
        </div>
      ) : null}
    </div>
  )
}

function Availability({
  feed,
  onRetry,
}: {
  readonly feed: SubscriptionSummary
  onRetry(feedId: number): Promise<void>
}) {
  const [retrying, startRetry] = useTransition()
  const { availability } = feed
  if (availability.state === 'unchecked') return <span className="x-feed-status x-grey">Waiting for first check</span>
  if (availability.state !== 'unavailable') return null
  return (
    <span className="x-feed-status">
      <span className="x-grey">{unavailableNote(availability)}</span>{' '}
      <Button
        className="x-more"
        focusableWhenDisabled
        disabled={retrying}
        aria-busy={retrying}
        aria-label={`Retry ${feed.title}`}
        onClick={() => {
          if (!retrying) startRetry(() => onRetry(feed.feedId))
        }}
      >
        {retrying ? 'Retrying' : 'Retry'}
      </Button>
    </span>
  )
}
