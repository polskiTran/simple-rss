import { Button } from '@base-ui/react/button'
import { useEffect, useEffectEvent, useState } from 'react'
import { useScreenTitle } from '../arrival.js'
import type { FeedDetail, OpmlImportReport, SubscriptionSummary } from '../../shared/api.js'
import { RHYTHM_LABELS, RHYTHMS, rhythmOf, type Rhythm } from '../../shared/rhythm.js'
import { ApiError, fetchFeedDetail, fetchSubscriptions, refreshFeed } from '../api.js'
import { CadenceStrip } from '../components/cadence-strip.js'
import { Choice } from '../components/choice.js'
import { Group } from '../components/group.js'
import { HomePageLink } from '../components/home-page-link.js'
import { Icon } from '../components/icon.js'
import { LoadFailure } from '../components/load-failure.js'
import { LoadingNote } from '../components/loading-note.js'
import { routedClick } from '../routed-link.js'
import { feedPathOf } from '../routing.js'
import { useResource } from '../use-resource.js'
import { AddFeedDialog } from './add-feed-dialog.js'
import { firstCheckFailure, retryFailure, unavailableNote } from './feed-language.js'

const FIRST_CHECK_ATTEMPTS = 8
const FIRST_CHECK_INTERVAL_MS = 2_000

const UNCHECKED_REFRESH_MS = 3_000
const UNCHECKED_REFRESH_ROUNDS = 20

/** Rows a Rhythm group shows before Show N more. */
const GROUP_PREVIEW = 6

type Order = 'rhythm' | 'name' | 'recent'

export interface FeedsViewProps {
  onOpenFeed(feedId: number): void
}

export function FeedsView({ onOpenFeed }: FeedsViewProps) {
  useScreenTitle('Feeds')
  const [state, { retry: reload, set }] = useResource(
    async (signal) => (await fetchSubscriptions(signal)).subscriptions,
    [],
  )
  const [notice, setNotice] = useState('')
  const [report, setReport] = useState<OpmlImportReport | undefined>(undefined)
  const [retryingFeedId, setRetryingFeedId] = useState<number | undefined>(undefined)
  const [refreshRound, setRefreshRound] = useState(0)
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

  async function subscribed(feedId: number) {
    setReport(undefined)
    setNotice('Subscribed. Checking the feed…')
    setRefreshRound(0)
    await refreshList()
    setNotice(await watchFirstCheck(feedId))
    await refreshList()
  }

  function imported(next: OpmlImportReport) {
    setNotice('')
    setReport(next)
    setRefreshRound(0)
    void refreshList()
  }

  async function retry(feedId: number) {
    if (retryingFeedId !== undefined) return
    setRetryingFeedId(feedId)
    setNotice('')
    try {
      await refreshFeed(feedId)
      setNotice('The feed answered. Checking works again.')
    } catch (error) {
      setNotice(retryFailure(error))
    } finally {
      setRetryingFeedId(undefined)
    }
    await refreshList()
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
            <a className="button" href="/api/subscriptions/export" download="subscriptions.opml">
              <Icon name="download" />
              Export<span className="wide-only"> OPML</span>
            </a>
            <AddFeedDialog
              onSubscribed={(created) => void subscribed(created.subscription.feedId)}
              onImported={imported}
            />
          </div>
        </div>
        {groups.length > 0 ? (
          <div className="toolbar">
            <div className="toolbar-group rhythm-jumps">
              {order === 'rhythm'
                ? groups.map(({ rhythm, members }) => (
                    <Button key={rhythm} className="button" onClick={() => enterGroup(rhythm)}>
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
            <RhythmGroup
              key={rhythm}
              rhythm={rhythm}
              subscriptions={members}
              retryingFeedId={retryingFeedId}
              onRetry={retry}
              onOpen={onOpenFeed}
            />
          ))
        ) : (
          <FeedRows
            subscriptions={ordered(subscriptions, order)}
            retryingFeedId={retryingFeedId}
            onRetry={retry}
            onOpen={onOpenFeed}
          />
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

/** A jump takes focus into the group as well as the view, so the keyboard carries on from there. */
function enterGroup(rhythm: Rhythm) {
  const group = document.getElementById(rhythmAnchor(rhythm))?.closest('section')
  if (!group) return
  group.tabIndex = -1
  group.focus({ preventScroll: true })
  showGroup(rhythm)
}

function showGroup(rhythm: Rhythm) {
  const group = document.getElementById(rhythmAnchor(rhythm))
  const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
  group?.scrollIntoView?.({ block: 'start', behavior: reduceMotion ? 'auto' : 'smooth' })
}

function RhythmGroup({
  rhythm,
  subscriptions,
  retryingFeedId,
  onRetry,
  onOpen,
}: {
  rhythm: Rhythm
  subscriptions: readonly SubscriptionSummary[]
  retryingFeedId: number | undefined
  onRetry: (feedId: number) => void
  onOpen: (feedId: number) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const shown = expanded ? subscriptions : subscriptions.slice(0, GROUP_PREVIEW)
  const hidden = subscriptions.slice(shown.length)

  const fold = () => {
    setExpanded(false)
    // Folding from the foot of a long group would leave the reader in the next
    // one; bring the group back when its heading has scrolled away.
    const top = document.getElementById(rhythmAnchor(rhythm))?.getBoundingClientRect().top ?? 0
    if (top < 0) showGroup(rhythm)
  }

  return (
    <Group
      id={rhythmAnchor(rhythm)}
      title={RHYTHM_LABELS[rhythm]}
      count={subscriptions.length}
      aside={rhythm === 'inactive' ? 'No items in 30 days' : undefined}
      className="panel"
    >
      <FeedRows subscriptions={shown} retryingFeedId={retryingFeedId} onRetry={onRetry} onOpen={onOpen} />
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
  retryingFeedId,
  onRetry,
  onOpen,
}: {
  subscriptions: readonly SubscriptionSummary[]
  retryingFeedId: number | undefined
  onRetry: (feedId: number) => void
  onOpen: (feedId: number) => void
}) {
  return (
    <div className="feed-rows">
      {subscriptions.map((subscription) => (
        <article className="feed-row" key={subscription.feedId}>
          <div className="feed-row-head">
            <h3 className="feed-row-name">
              <a href={feedPathOf(subscription.feedId)} onClick={routedClick(() => onOpen(subscription.feedId))}>
                {subscription.title}
              </a>
            </h3>
            <CadenceStrip counts={subscription.cadence} title={subscription.title} />
          </div>
          <HomePageLink
            className="feed-row-domain"
            domain={subscription.domain}
            homePageUrl={subscription.homePageUrl}
            arrow
          />
          <Availability
            subscription={subscription}
            retrying={retryingFeedId === subscription.feedId}
            onRetry={onRetry}
          />
        </article>
      ))}
    </div>
  )
}

/** A row also says when a Feed has never been checked, or why checking fails, and offers the retry. */
function Availability({
  subscription,
  retrying,
  onRetry,
}: {
  subscription: SubscriptionSummary
  retrying: boolean
  onRetry: (feedId: number) => void
}) {
  const { availability } = subscription
  if (availability.state === 'unchecked') return <p className="note feed-row-note">Waiting for first check</p>
  if (availability.state !== 'unavailable') return null

  return (
    <div className="feed-row-note">
      <p className="note">{unavailableNote(availability)}</p>
      <Button
        className="button button-small"
        focusableWhenDisabled
        disabled={retrying}
        onClick={() => onRetry(subscription.feedId)}
      >
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

async function watchFirstCheck(feedId: number): Promise<string> {
  for (let attempt = 0; attempt < FIRST_CHECK_ATTEMPTS; attempt += 1) {
    if (attempt > 0) await wait(FIRST_CHECK_INTERVAL_MS)
    let detail: FeedDetail
    try {
      detail = await fetchFeedDetail(feedId)
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) return 'Already subscribed.'
      continue
    }
    if (detail.availability.lastSuccessAt) {
      return detail.items.length === 1
        ? 'Subscribed. 1 item in the digest.'
        : `Subscribed. ${detail.items.length} items in the digest.`
    }
    if (detail.availability.consecutiveFailures > 0) {
      return firstCheckFailure(detail.availability.category)
    }
  }
  return 'Still checking. The feed will appear in the list.'
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}
