import { Button } from '@base-ui/react/button'
import { Dialog } from '@base-ui/react/dialog'
import { Toggle } from '@base-ui/react/toggle'
import { ToggleGroup } from '@base-ui/react/toggle-group'
import { useEffect, useRef, useState } from 'react'
import type { FeedAvailabilityCategory, SubscriptionSummary } from '../../shared/api.js'
import { LoadingNote } from '../components/loading-note.js'
import { PrototypeSwitcher, variantInAddress, writeVariantToAddress } from '../components/prototype-switcher.js'
import { SUBSCRIPTION_FAILURE_COPY } from './feed-language.js'
import './preview-dialog.prototype.css'

/* PROTOTYPE — throwaway. Wayfinder ticket #41: "The preview dialog: layout and states".

   Three variants of the proven-first subscribe preview on the existing `/feeds`
   route, switchable via `?variant=`. `POST /api/feeds/preview` does not exist
   yet, so `previewStub` answers from the URL typed; nothing here touches the
   server. Each variant takes its own stance on three things: what leads (the
   Feed as a row / the question / the items), how the "other feeds on this page"
   chooser is drawn, and where the wait happens (under the field / inside the
   dialog). */

export const PREVIEW_VARIANTS = [
  { key: 'A', name: 'the row — wait under the field' },
  { key: 'B', name: 'the question — wait in the dialog' },
  { key: 'C', name: 'the reading — items at full size' },
] as const

type VariantKey = (typeof PREVIEW_VARIANTS)[number]['key']

/* ---------- the stubbed contract, shaped as #39 describes it ---------- */

interface PreviewItem {
  readonly title: string
  readonly publishedAt: string
}

interface FeedPreview {
  readonly feedUrl: string
  readonly title: string
  readonly host: string
  readonly description: string | null
  readonly items: readonly PreviewItem[]
}

interface Alternative {
  readonly feedUrl: string
  readonly title: string
}

type PreviewResponse =
  | { readonly kind: 'feed'; readonly feed: FeedPreview; readonly alternatives: readonly Alternative[] }
  | { readonly kind: 'subscribed'; readonly feed: FeedPreview; readonly feedId: number }
  | { readonly kind: 'failed'; readonly code: 'no_feed_found' | FeedAvailabilityCategory }

const PREVIEW_DEADLINE_MS = 15_000

const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString()

const EARENDIL: FeedPreview = {
  feedUrl: 'https://earendil.com/posts/feed.rss',
  title: 'Earendil',
  host: 'earendil.com',
  description: 'Notes on systems, software, and the occasional mountain.',
  items: [
    { title: 'The cost of a conditional request', publishedAt: daysAgo(2) },
    { title: 'What a scheduler hides', publishedAt: daysAgo(9) },
    { title: 'Reading feeds with one SQLite file and no queue', publishedAt: daysAgo(22) },
    { title: 'On autodiscovery', publishedAt: daysAgo(37) },
    { title: 'A quieter inbox', publishedAt: daysAgo(64) },
  ],
}

const EXAMPLE_POSTS: Alternative = { feedUrl: 'https://example.blog/feed/', title: 'Example Blog' }
const EXAMPLE_ALTERNATIVES: readonly Alternative[] = [
  EXAMPLE_POSTS,
  { feedUrl: 'https://example.blog/comments/feed/', title: 'Example Blog » Comments Feed' },
  { feedUrl: 'https://example.blog/podcast/feed/', title: 'Example Blog Podcast' },
]

function exampleFeed(alternative: Alternative): FeedPreview {
  const items = alternative.title.includes('Comments')
    ? [
        { title: 'Comment on "Spring cleaning" by Ada', publishedAt: daysAgo(1) },
        { title: 'Comment on "Spring cleaning" by Lin', publishedAt: daysAgo(1) },
        { title: 'Comment on "A year of notes" by Ada', publishedAt: daysAgo(4) },
        { title: 'Comment on "A year of notes" by Marek', publishedAt: daysAgo(5) },
        { title: 'Comment on "Hello again" by Sol', publishedAt: daysAgo(12) },
      ]
    : alternative.title.includes('Podcast')
      ? [
          { title: 'Episode 14 — the long quiet', publishedAt: daysAgo(6) },
          { title: 'Episode 13 — on finishing', publishedAt: daysAgo(20) },
          { title: 'Episode 12 — a conversation with Lin', publishedAt: daysAgo(34) },
          { title: 'Episode 11 — notebooks', publishedAt: daysAgo(48) },
          { title: 'Episode 10 — starting over', publishedAt: daysAgo(62) },
        ]
      : [
          { title: 'Spring cleaning', publishedAt: daysAgo(3) },
          { title: 'A year of notes', publishedAt: daysAgo(11) },
          { title: 'Hello again', publishedAt: daysAgo(30) },
          { title: 'What I read in March', publishedAt: daysAgo(52) },
          { title: 'The garden, continued', publishedAt: daysAgo(80) },
        ]
  return {
    feedUrl: alternative.feedUrl,
    title: alternative.title,
    host: 'example.blog',
    description: alternative.title.includes('Comments') ? null : 'A blog about nothing in particular, weekly.',
    items,
  }
}

/** Answers from the address alone. See SCENARIOS for the words that pick each path. */
function previewStub(
  url: string,
  subscriptions: readonly SubscriptionSummary[],
  signal: AbortSignal,
): Promise<PreviewResponse> {
  const line = url.toLowerCase()
  const chosen = EXAMPLE_ALTERNATIVES.find((alternative) => alternative.feedUrl === url)
  const [delay, response]: [number, PreviewResponse] = line.includes('slow')
    ? [PREVIEW_DEADLINE_MS, { kind: 'failed', code: 'timeout' }]
    : line.includes('fail')
      ? [800, { kind: 'failed', code: 'no_feed_found' }]
      : line.includes('xml')
        ? [900, { kind: 'failed', code: 'invalid_feed' }]
        : line.includes('already')
          ? [
              700,
              subscriptions[0]
                ? {
                    kind: 'subscribed',
                    feedId: subscriptions[0].feedId,
                    feed: { ...EARENDIL, title: subscriptions[0].title, host: subscriptions[0].domain },
                  }
                : { kind: 'subscribed', feedId: 1, feed: EARENDIL },
            ]
          : chosen
            ? [600, { kind: 'feed', feed: exampleFeed(chosen), alternatives: EXAMPLE_ALTERNATIVES }]
            : line.includes('example.blog')
              ? [1_400, { kind: 'feed', feed: exampleFeed(EXAMPLE_POSTS), alternatives: EXAMPLE_ALTERNATIVES }]
              : [900, { kind: 'feed', feed: EARENDIL, alternatives: [] }]

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => resolve(response), delay)
    signal.addEventListener('abort', () => {
      clearTimeout(timer)
      reject(new DOMException('aborted', 'AbortError'))
    })
  })
}

export const SCENARIOS = [
  { label: 'a feed', url: 'https://earendil.com/posts/feed.rss' },
  { label: 'a page with 3 feeds', url: 'https://example.blog' },
  { label: 'already subscribed', url: 'https://already.example.com/feed' },
  { label: 'no feed', url: 'https://example.com/fail' },
  { label: 'bad xml', url: 'https://example.com/feed.xml' },
  { label: 'slow (15 s)', url: 'https://slow.example.com/feed' },
] as const

/* ---------- state ---------- */

type PreviewState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'previewing'; readonly url: string; readonly alternatives: readonly Alternative[] }
  | { readonly kind: 'feed'; readonly feed: FeedPreview; readonly alternatives: readonly Alternative[] }
  | { readonly kind: 'subscribed'; readonly feed: FeedPreview; readonly feedId: number }

const FAILURE_COPY: Readonly<Record<'no_feed_found' | FeedAvailabilityCategory, string>> = {
  no_feed_found: 'no feed was found at that address',
  unreachable: SUBSCRIPTION_FAILURE_COPY.feed_unreachable ?? '',
  timeout: SUBSCRIPTION_FAILURE_COPY.feed_timeout ?? '',
  too_large: SUBSCRIPTION_FAILURE_COPY.feed_too_large ?? '',
  unsupported_content: SUBSCRIPTION_FAILURE_COPY.unsupported_feed ?? '',
  http_error: 'the publisher is answering with an error',
  invalid_feed: SUBSCRIPTION_FAILURE_COPY.malformed_feed ?? '',
}

export interface PreviewPrototype {
  readonly variant: VariantKey
  /** Replaces the Feeds view's subscribe: starts a preview of the typed address. */
  start(url: string): void
  /** What stands in the notice line under the URL field while the prototype drives it. */
  readonly note: React.ReactNode
  readonly dialog: React.ReactNode
  readonly bar: React.ReactNode
}

export function usePreviewPrototype({
  subscriptions,
  onOpenFeed,
  onTry,
}: {
  subscriptions: readonly SubscriptionSummary[]
  onOpenFeed(feedId: number): void
  onTry(url: string): void
}): PreviewPrototype | undefined {
  const [variant, setVariant] = useState<VariantKey | undefined>(() => {
    const key = variantInAddress()
    return PREVIEW_VARIANTS.some((candidate) => candidate.key === key) ? (key as VariantKey) : undefined
  })
  const [state, setState] = useState<PreviewState>({ kind: 'idle' })
  const [failure, setFailure] = useState('')
  const [subscribing, setSubscribing] = useState(false)
  const request = useRef<AbortController | undefined>(undefined)

  useEffect(() => () => request.current?.abort(), [])

  if (!variant) return undefined

  function run(url: string, alternatives: readonly Alternative[]) {
    request.current?.abort()
    const controller = new AbortController()
    request.current = controller
    setFailure('')
    setState({ kind: 'previewing', url, alternatives })
    previewStub(url, subscriptions, controller.signal)
      .then((response) => {
        if (controller.signal.aborted) return
        if (response.kind === 'failed') {
          setState({ kind: 'idle' })
          setFailure(FAILURE_COPY[response.code])
          return
        }
        setState(response)
      })
      .catch(() => {})
  }

  function cancel() {
    request.current?.abort()
    setState({ kind: 'idle' })
  }

  function subscribe(feed: FeedPreview) {
    setSubscribing(true)
    setTimeout(() => {
      setSubscribing(false)
      setState({ kind: 'idle' })
      setFailure(`subscribed — ${feed.items.length} items in the digest`)
    }, 500)
  }

  const hostOf = (url: string) => {
    try {
      return new URL(url).host
    } catch {
      return url
    }
  }

  const waitingUnderField = variant === 'A' && state.kind === 'previewing'
  const note = waitingUnderField ? (
    <LoadingNote className="notice feed-notice" announce>
      {`previewing ${hostOf(state.url)}`}
    </LoadingNote>
  ) : (
    <p className="notice feed-notice" aria-live="polite">
      {failure}
    </p>
  )

  const open = state.kind === 'feed' || state.kind === 'subscribed' || (state.kind === 'previewing' && variant !== 'A')

  const shared: VariantProps | undefined =
    state.kind === 'idle'
      ? undefined
      : {
          state,
          subscribing,
          host: state.kind === 'previewing' ? hostOf(state.url) : state.feed.host,
          onChoose: (alternative, alternatives) => run(alternative.feedUrl, alternatives),
          onSubscribe: subscribe,
          onOpenFeed: (feedId) => {
            setState({ kind: 'idle' })
            onOpenFeed(feedId)
          },
        }

  const dialog = (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        if (!next && !subscribing) cancel()
      }}
    >
      <Dialog.Portal>
        <Dialog.Backdrop className="overlay-backdrop" />
        <Dialog.Viewport className="overlay-viewport">
          <Dialog.Popup
            className={`overlay-popup preview-popup preview-${variant.toLowerCase()}`}
            finalFocus={() => document.querySelector<HTMLElement>('.search-input')}
          >
            {!shared ? null : variant === 'A' ? (
              <VariantA {...shared} />
            ) : variant === 'B' ? (
              <VariantB {...shared} />
            ) : (
              <VariantC {...shared} />
            )}
          </Dialog.Popup>
        </Dialog.Viewport>
      </Dialog.Portal>
    </Dialog.Root>
  )

  const bar = (
    <PrototypeSwitcher
      variants={PREVIEW_VARIANTS}
      current={variant}
      onChange={(key) => {
        cancel()
        writeVariantToAddress(key)
        setVariant(key as VariantKey)
      }}
    >
      {SCENARIOS.map((scenario) => (
        <button
          key={scenario.url}
          type="button"
          className="prototype-bar-chip"
          onClick={() => {
            onTry(scenario.url)
            run(scenario.url, [])
          }}
        >
          {scenario.label}
        </button>
      ))}
    </PrototypeSwitcher>
  )

  return { variant, start: (url) => run(url, []), note, dialog, bar }
}

/* ---------- the variants ---------- */

interface VariantProps {
  readonly state: Exclude<PreviewState, { kind: 'idle' }>
  readonly subscribing: boolean
  readonly host: string
  onChoose(alternative: Alternative, alternatives: readonly Alternative[]): void
  onSubscribe(feed: FeedPreview): void
  onOpenFeed(feedId: number): void
}

/** today · yesterday · 3 days ago · 2 weeks ago · 3 months ago */
function relativeDate(iso: string): string {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000)
  if (days <= 0) return 'today'
  if (days === 1) return 'yesterday'
  if (days < 14) return `${days} days ago`
  if (days < 60) return `${Math.floor(days / 7)} weeks ago`
  return `${Math.floor(days / 30)} months ago`
}

/** The two words at the bottom: subscribe / cancel, or open feed / cancel when already subscribed. */
function Choice({ state, subscribing, onSubscribe, onOpenFeed }: VariantProps) {
  const working = subscribing || state.kind === 'previewing'
  return (
    <p className="overlay-choice">
      {state.kind === 'subscribed' ? (
        <Button className="text-button" onClick={() => onOpenFeed(state.feedId)}>
          open feed
        </Button>
      ) : state.kind === 'feed' ? (
        <Button
          className="text-button"
          focusableWhenDisabled
          disabled={subscribing}
          onClick={() => onSubscribe(state.feed)}
        >
          {subscribing ? 'subscribing…' : 'subscribe'}
        </Button>
      ) : null}
      <Dialog.Close className="text-button" disabled={subscribing} render={<Button focusableWhenDisabled />}>
        {working && state.kind === 'previewing' ? 'stop' : 'cancel'}
      </Dialog.Close>
    </p>
  )
}

/* A — the Feeds-list row, then what it would bring. Alternatives are a line of words.
   The wait is not here: it lives under the URL field, and this opens once the preview lands. */
function VariantA(props: VariantProps) {
  const { state, host, onChoose } = props
  if (state.kind === 'previewing') return null
  const { feed } = state
  const alternatives = state.kind === 'feed' ? state.alternatives : []
  return (
    <div className="preview-arrive">
      <Dialog.Title className="content-item-title preview-a-title">{feed.title}</Dialog.Title>
      <p className="content-meta">
        <span>{host}</span>
        {state.kind === 'subscribed' ? <span className="preview-a-already">already in your feeds</span> : null}
      </p>
      {feed.description ? (
        <Dialog.Description className="overlay-description">{feed.description}</Dialog.Description>
      ) : null}
      {alternatives.length > 1 ? (
        <p className="preview-a-alternatives">
          <span>also on this page</span>
          {alternatives
            .filter((alternative) => alternative.feedUrl !== feed.feedUrl)
            .map((alternative) => (
              <Button
                key={alternative.feedUrl}
                className="text-button preview-a-alternative"
                onClick={() => onChoose(alternative, alternatives)}
              >
                {shortAlternativeTitle(alternative, alternatives)}
              </Button>
            ))}
        </p>
      ) : null}
      <ol className="preview-a-items">
        {feed.items.map((item) => (
          <li key={item.title}>
            <span className="preview-a-item-title">{item.title}</span>
            <span className="preview-a-item-date">{relativeDate(item.publishedAt)}</span>
          </li>
        ))}
      </ol>
      <Choice {...props} />
    </div>
  )
}

/** "Example Blog » Comments Feed" among siblings that all start with "Example Blog" reads as "comments feed". */
function shortAlternativeTitle(alternative: Alternative, all: readonly Alternative[]): string {
  const first = all[0]?.title ?? ''
  const stripped = alternative.title.startsWith(first) ? alternative.title.slice(first.length) : alternative.title
  return stripped.replace(/^[\s»·—-]+/, '').toLowerCase() || alternative.title
}

/* B — the question, in the overlay voice the unsubscribe and edit dialogs already speak.
   The wait happens here. Alternatives are stacked choices. */
function VariantB(props: VariantProps) {
  const { state, host, onChoose } = props
  if (state.kind === 'previewing') {
    return (
      <>
        <Dialog.Title className="overlay-title">previewing {host}</Dialog.Title>
        <LoadingNote className="overlay-description" announce>
          reading the feed — this can take a few seconds
        </LoadingNote>
        <Choice {...props} />
      </>
    )
  }
  const { feed } = state
  const alternatives = state.kind === 'feed' ? state.alternatives : []
  return (
    <div className="preview-arrive">
      <Dialog.Title className="overlay-title">
        {state.kind === 'subscribed' ? `already subscribed to ${feed.title}` : `subscribe to ${feed.title}?`}
      </Dialog.Title>
      <Dialog.Description className="overlay-description">
        {host}
        {feed.description ? ` — ${feed.description}` : ''}
      </Dialog.Description>
      {alternatives.length > 1 ? (
        <div className="preview-b-alternatives">
          <p className="preview-b-caption">this page declares {alternatives.length} feeds</p>
          {alternatives.map((alternative) => (
            <Button
              key={alternative.feedUrl}
              className="text-button preview-b-alternative"
              disabled={alternative.feedUrl === feed.feedUrl}
              onClick={() => onChoose(alternative, alternatives)}
            >
              {alternative.title}
            </Button>
          ))}
        </div>
      ) : null}
      <p className="preview-b-caption">recent items</p>
      <ol className="preview-b-items">
        {feed.items.map((item) => (
          <li key={item.title}>
            <span className="preview-b-item-title">{item.title}</span>
            <span className="preview-b-item-date">{relativeDate(item.publishedAt)}</span>
          </li>
        ))}
      </ol>
      <Choice {...props} />
    </div>
  )
}

/* C — read before you subscribe: the five items at the Digest's own size on a wider paper.
   Alternatives are a tab row across the top; the Feed itself is the opened-Feed header line. */
function VariantC(props: VariantProps) {
  const { state, host, onChoose } = props
  if (state.kind === 'previewing') {
    return (
      <>
        <Dialog.Title className="feed-header preview-c-header">
          <span className="feed-header-title">previewing</span>
          <span>{host}</span>
        </Dialog.Title>
        <LoadingNote className="feed-description" announce>
          reading the feed
        </LoadingNote>
        <Choice {...props} />
      </>
    )
  }
  const { feed } = state
  const alternatives = state.kind === 'feed' ? state.alternatives : []
  return (
    <div className="preview-arrive">
      {alternatives.length > 1 ? (
        <ToggleGroup
          className="preview-c-tabs"
          aria-label="feeds on this page"
          value={[feed.feedUrl]}
          onValueChange={(chosen) => {
            const next = alternatives.find((alternative) => alternative.feedUrl === chosen[0])
            if (next && next.feedUrl !== feed.feedUrl) onChoose(next, alternatives)
          }}
        >
          {alternatives.map((alternative) => (
            <Toggle key={alternative.feedUrl} className="text-button preview-c-tab" value={alternative.feedUrl}>
              {shortAlternativeTitle(alternative, alternatives) === alternative.title.toLowerCase()
                ? alternative.title
                : shortAlternativeTitle(alternative, alternatives)}
            </Toggle>
          ))}
        </ToggleGroup>
      ) : null}
      <p className="feed-header preview-c-header">
        <Dialog.Title className="feed-header-title" render={<span />}>
          {feed.title}
        </Dialog.Title>
        <span>{host}</span>
        {state.kind === 'subscribed' ? <span>already in your feeds</span> : null}
      </p>
      {feed.description ? (
        <Dialog.Description className="feed-description">{feed.description}</Dialog.Description>
      ) : null}
      <div className="content-list preview-c-items">
        {feed.items.map((item) => (
          <article className="content-item" key={item.title}>
            <h3 className="content-item-title">{item.title}</h3>
            <p className="content-meta">
              <time dateTime={item.publishedAt}>{relativeDate(item.publishedAt)}</time>
            </p>
          </article>
        ))}
      </div>
      <Choice {...props} />
    </div>
  )
}
