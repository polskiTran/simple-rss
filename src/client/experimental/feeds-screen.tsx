import { use } from 'react'
import { RHYTHM_LABELS, RHYTHMS, rhythmOf } from '../../shared/rhythm.js'
import { useScreenTitle } from '../arrival.js'
import { counted } from '../day-names.js'
import { AddFeedRows } from './add-feed.js'
import { FeedRow, LedgerRow, SubscriptionsContext } from './parts.js'

export function FeedsScreen({
  onOpenFeed,
  onSubscribed,
  onImported,
}: {
  onOpenFeed(feedId: number): void
  onSubscribed(feedId: number): void
  onImported(): void
}) {
  useScreenTitle('Feeds')
  const { list } = use(SubscriptionsContext)
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
          onImported={onImported}
        />
      </header>

      {tiers.map(({ rhythm, members }) => (
        <section key={rhythm} className="x-day x-grid" aria-labelledby={`rhythm-${rhythm}`}>
          <h2 className="x-day-label x-tinted" id={`rhythm-${rhythm}`} data-rhythm={rhythm}>
            {RHYTHM_LABELS[rhythm]}
          </h2>
          <div className="x-rows">
            {members.map((feed) => (
              <FeedRow key={feed.feedId} feed={feed} onOpen={onOpenFeed} />
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
