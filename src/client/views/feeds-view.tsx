import { Button } from '@base-ui/react/button'
import { useEffect, useEffectEvent, useState, useTransition } from 'react'
import { useScreenTitle } from '../arrival.js'
import type { FeedDetail, OpmlImportReport, SubscriptionSummary } from '../../shared/api.js'
import { RHYTHM_LABELS, RHYTHMS, rhythmOf, type Rhythm } from '../../shared/rhythm.js'
import { ApiError, fetchFeedDetail, fetchSubscriptions, refreshFeed } from '../api.js'
import { Choice } from '../components/choice.js'
import { FeedRow } from '../components/feed-row.js'
import { enterSection, Group } from '../components/group.js'
import { Icon } from '../components/icon.js'
import { LoadFailure } from '../components/load-failure.js'
import { LoadingNote } from '../components/loading-note.js'
import { counted } from '../day-names.js'
import { useResource } from '../use-resource.js'
import { AddFeedDialog } from './add-feed-dialog.js'
import { AddFeedPrototype } from './add-feed-prototype.js'
import { firstCheckFailure, retryFailure, unavailableNote } from './feed-language.js'

/** How often the list is read again while a Subscription waits for its first check. */
const POLL_INTERVAL_MS = 2_000
const POLL_ROUNDS = 30
/** Rounds a new Subscription's own first check is watched before the notice gives up on it. */
const FIRST_CHECK_ROUNDS = 8

/** Rows a Rhythm group shows before Show N more. */
const GROUP_PREVIEW = 6

type Order = 'rhythm' | 'name' | 'recent'

/** Where polling is: its round, and the new Subscription whose first check the notice waits on. */
interface Poll {
  readonly round: number
  readonly watching: number | undefined
}

interface FeedsViewProps {
  onOpenFeed(feedId: number): void
}

export function FeedsView({ onOpenFeed }: FeedsViewProps) {
  useScreenTitle('Feeds')
  const [state, { retry: reload, set }] = useResource(
    'subscriptions',
    async (signal) => (await fetchSubscriptions(signal)).subscriptions,
  )
  const [notice, setNotice] = useState('')
  const [report, setReport] = useState<OpmlImportReport | undefined>(undefined)
  const [poll, setPoll] = useState<Poll>({ round: 0, watching: undefined })
  const [order, setOrder] = useState<Order>('rhythm')

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

  // One round of polling: how the watched first check went, then the list.
  const pollRound = useEffectEvent(async (signal: AbortSignal) => {
    let { watching } = poll
    if (watching !== undefined) {
      const outcome = await firstCheckOutcome(watching, signal)
      if (signal.aborted) return
      if (outcome !== undefined || poll.round + 1 >= FIRST_CHECK_ROUNDS) {
        setNotice(outcome ?? 'Still checking. The feed will appear in the list.')
        watching = undefined
      }
    }
    try {
      const { subscriptions } = await fetchSubscriptions(signal)
      if (!signal.aborted) set(() => subscriptions)
    } catch {}
    if (!signal.aborted) setPoll({ round: poll.round + 1, watching })
  })

  // Polls while a first check is awaited, and stops on leaving the screen.
  useEffect(() => {
    if (state.kind !== 'loaded') return
    const unchecked = state.value.some((subscription) => subscription.availability.state === 'unchecked')
    if (poll.watching === undefined && (!unchecked || poll.round >= POLL_ROUNDS)) return
    const round = new AbortController()
    // A new Subscription's first round goes at once.
    const timer = window.setTimeout(
      () => void pollRound(round.signal),
      poll.round === 0 && poll.watching !== undefined ? 0 : POLL_INTERVAL_MS,
    )
    return () => {
      window.clearTimeout(timer)
      round.abort()
    }
  }, [state, poll])

  function subscribed(created: SubscriptionSummary) {
    setReport(undefined)
    setNotice('Subscribed. Checking the feed…')
    if (state.kind === 'loaded') {
      set((current) => [...current.filter((listed) => listed.feedId !== created.feedId), created])
    } else {
      reload()
    }
    setPoll({ round: 0, watching: created.feedId })
  }

  function imported(next: OpmlImportReport) {
    setNotice('')
    setReport(next)
    setPoll({ round: 0, watching: undefined })
    void refreshList()
  }

  /** Called outside the row's transition, so the notice clears at once and a repeated answer is announced again. */
  async function retry(feedId: number) {
    setNotice('')
    try {
      await refreshFeed(feedId)
      setNotice('The feed answered. Checking works again.')
    } catch (error) {
      setNotice(retryFailure(error))
    }
    void refreshList()
  }

  const subscriptions = state.kind === 'loaded' ? state.value : undefined
  const groups = subscriptions ? rhythmGroups(subscriptions) : []

  return (
    <div className="view">
      <header className="page-head">
        <div className="toolbar">
          <h1 className="page-title">
            Feeds
            {subscriptions ? <span className="page-title-companion">{subscriptions.length}</span> : null}
          </h1>
          <div className="toolbar-group feeds-actions">
            {subscriptions?.length === 0 ? null : (
              <a className="button" href="/api/subscriptions/export" download="subscriptions.opml">
                <Icon name="download" />
                <span>
                  Export<span className="wide-only"> OPML</span>
                </span>
              </a>
            )}
            {/* PROTOTYPE (#92): the subscribe-flow variants stand in for Add feed in development. */}
            {import.meta.env.DEV ? (
              <AddFeedPrototype />
            ) : (
              <AddFeedDialog onSubscribed={(created) => subscribed(created.subscription)} onImported={imported} />
            )}
          </div>
        </div>
        {groups.length > 0 ? (
          <div className="toolbar">
            <div className="toolbar-group rhythm-jumps">
              {order === 'rhythm'
                ? groups.map(({ rhythm, members }) => (
                    <Button key={rhythm} className="button" onClick={() => enterSection(rhythmAnchor(rhythm))}>
                      {RHYTHM_LABELS[rhythm]}
                      <span className="button-count">{members.length}</span>
                    </Button>
                  ))
                : null}
            </div>
            <Choice
              label="Order"
              options={[
                { value: 'rhythm', label: 'By rhythm' },
                { value: 'name', label: 'By name' },
                { value: 'recent', label: 'Recently added' },
              ]}
              value={order}
              onChange={setOrder}
            />
          </div>
        ) : null}
      </header>

      <div className="feeds-notices" aria-live="polite">
        <p className="note">{notice}</p>
        <ImportReport report={report} />
      </div>

      {state.kind === 'loading' ? <LoadingNote>Loading feeds</LoadingNote> : null}
      {state.kind === 'unavailable' || state.kind === 'unreachable' ? (
        <LoadFailure subject="Your feeds" kind={state.kind} onRetry={reload} />
      ) : null}
      {subscriptions && subscriptions.length === 0 ? (
        <p className="note">No feeds yet. Add one by its site or feed address, or import an OPML file.</p>
      ) : null}

      {subscriptions && subscriptions.length > 0 ? (
        order === 'rhythm' ? (
          groups.map(({ rhythm, members }) => (
            <RhythmGroup key={rhythm} rhythm={rhythm} subscriptions={members} onRetry={retry} onOpen={onOpenFeed} />
          ))
        ) : (
          <FeedRows subscriptions={ordered(subscriptions, order)} onRetry={retry} onOpen={onOpenFeed} />
        )
      ) : null}
    </div>
  )
}

/** The flat orders: by effective title, or newest Subscription first. */
function ordered(subscriptions: readonly SubscriptionSummary[], order: 'name' | 'recent') {
  return subscriptions.toSorted((left, right) =>
    order === 'recent'
      ? right.subscribedAt.localeCompare(left.subscribedAt) || left.title.localeCompare(right.title)
      : left.title.localeCompare(right.title),
  )
}

/** The Rhythms that have Subscriptions, in Rhythm order. */
function rhythmGroups(subscriptions: readonly SubscriptionSummary[]) {
  const byRhythm = Object.groupBy(subscriptions, (subscription) => rhythmOf(subscription.cadence))
  return RHYTHMS.flatMap((rhythm) => {
    const members = byRhythm[rhythm]
    return members ? [{ rhythm, members }] : []
  })
}

function rhythmAnchor(rhythm: Rhythm): string {
  return `rhythm-${rhythm}`
}

function RhythmGroup({
  rhythm,
  subscriptions,
  onRetry,
  onOpen,
}: {
  rhythm: Rhythm
  subscriptions: readonly SubscriptionSummary[]
  onRetry: (feedId: number) => Promise<void>
  onOpen: (feedId: number) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const shown = expanded ? subscriptions : subscriptions.slice(0, GROUP_PREVIEW)
  const hidden = subscriptions.slice(shown.length)

  const fold = () => {
    setExpanded(false)
    // Folding from the foot of a long group would leave the reader in the next
    // one; bring the group back when its heading has scrolled away.
    const heading = document.getElementById(rhythmAnchor(rhythm))
    if (heading && heading.getBoundingClientRect().top < 0) heading.scrollIntoView({ block: 'start' })
  }

  return (
    <Group
      id={rhythmAnchor(rhythm)}
      title={RHYTHM_LABELS[rhythm]}
      count={subscriptions.length}
      aside={rhythm === 'inactive' ? 'No items in 30 days' : undefined}
      className="panel"
    >
      <FeedRows subscriptions={shown} onRetry={onRetry} onOpen={onOpen} />
      {hidden.length > 0 ? (
        <div className="more">
          <Button className="button" onClick={() => setExpanded(true)}>
            Show {hidden.length} more
            <Icon name="chevron-down" />
          </Button>
          <p className="note more-names">{hidden.map((subscription) => subscription.title).join(', ')}</p>
        </div>
      ) : expanded ? (
        <div className="more">
          <Button className="button" onClick={fold}>
            Show fewer
            <Icon name="chevron-up" />
          </Button>
        </div>
      ) : null}
    </Group>
  )
}

function FeedRows({
  subscriptions,
  onRetry,
  onOpen,
}: {
  subscriptions: readonly SubscriptionSummary[]
  onRetry: (feedId: number) => Promise<void>
  onOpen: (feedId: number) => void
}) {
  return (
    <div className="feed-rows">
      {subscriptions.map((subscription) => (
        <FeedRow key={subscription.feedId} feed={subscription} onOpen={onOpen}>
          <Availability subscription={subscription} onRetry={onRetry} />
        </FeedRow>
      ))}
    </div>
  )
}

/** A row also says when a Feed has never been checked, or why checking fails, and offers the retry. */
function Availability({
  subscription,
  onRetry,
}: {
  subscription: SubscriptionSummary
  onRetry: (feedId: number) => Promise<void>
}) {
  const [retrying, startRetry] = useTransition()
  const { availability } = subscription
  if (availability.state === 'unchecked') return <p className="note feed-row-note">Waiting for first check</p>
  if (availability.state !== 'unavailable') return null

  const press = () => {
    if (retrying) return
    const retried = onRetry(subscription.feedId)
    startRetry(() => retried)
  }

  return (
    <div className="feed-row-note">
      <p className="note">{unavailableNote(availability)}</p>
      <Button className="button button-small" focusableWhenDisabled disabled={retrying} onClick={press}>
        <Icon name="refresh" />
        {retrying ? 'Retrying…' : 'Retry'}
      </Button>
    </div>
  )
}

function ImportReport({ report }: { report: OpmlImportReport | undefined }) {
  if (!report) return null
  if (report.added === 0 && report.alreadySubscribed === 0 && report.unusable.length === 0) {
    return <p className="note">That OPML file lists no feeds.</p>
  }

  return (
    <div className="import-report">
      <p className="note">{`Imported: ${report.added} added, ${report.alreadySubscribed} already subscribed.`}</p>
      {report.unusable.length > 0 ? (
        <ul className="import-report-details">
          {report.unusable.map((url) => (
            <li key={url}>{url}: not a usable feed address</li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}

/** What a new Subscription's first check came to, once it has come to anything. */
async function firstCheckOutcome(feedId: number, signal: AbortSignal): Promise<string | undefined> {
  let detail: FeedDetail
  try {
    detail = await fetchFeedDetail(feedId, signal)
  } catch (error) {
    // ADR 0007: the first check found a Feed already subscribed under another URL and merged this Subscription into it.
    if (error instanceof ApiError && error.status === 404) return 'Already subscribed.'
    return undefined
  }
  if (detail.availability.lastSuccessDate) {
    return `Subscribed. ${counted(detail.items.length, 'item')} in the digest.`
  }
  if (detail.availability.consecutiveFailures > 0) return firstCheckFailure(detail.availability.category)
  return undefined
}
