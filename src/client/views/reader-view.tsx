import { Button } from '@base-ui/react/button'
import { Suspense, lazy, useEffect, useState } from 'react'
import type { FeedContent, ReaderArticle, ReaderDeadlineStage, ReaderItem, ReadingSource } from '../../shared/api.js'
import { useScreenTitle } from '../arrival.js'
import { ApiError, fetchReaderArticle, fetchReaderItem } from '../api.js'
import { BackButton } from '../components/back-button.js'
import { Choice } from '../components/choice.js'
import { ChromeToolbar } from '../components/chrome-toolbar.js'
import { Icon } from '../components/icon.js'
import { RoutedLink } from '../components/routed-link.js'
import { LoadFailure } from '../components/load-failure.js'
import { LoadingNote } from '../components/loading-note.js'
import { namedDay } from '../day-names.js'
import { READING_SOURCE_LABELS, READING_SOURCE_OPTIONS } from '../reading-source.js'
import { SaveToggle } from '../components/save-toggle.js'
import { feedPath, readerPath, type Origin } from '../routing.js'
import { useResource } from '../use-resource.js'

const preloadArticleMarkdown = () => import('../components/article-markdown.js')
const ArticleMarkdown = lazy(async () => ({
  default: (await preloadArticleMarkdown()).ArticleMarkdown,
}))

const READER_MARKS = {
  entry: 'reader:entry',
  articleResponse: 'reader:article-response',
  rendererReady: 'reader:renderer-ready',
  markdownCommitted: 'reader:markdown-committed',
} as const

function MarkdownCommitted() {
  useEffect(() => {
    performance.mark(READER_MARKS.markdownCommitted)
  }, [])
  return null
}

const DEADLINE_REFETCH_DELAY_MS = 2_000
const DEADLINE_REFETCH_ATTEMPTS = 2

const STAGE_NOTES = {
  publisher: 'Waiting on the publisher',
  parsing: 'Still reading the original webpage',
} as const satisfies Record<ReaderDeadlineStage, string>

interface ReaderViewProps {
  readonly feedItemId: number
  readonly origin: Origin
  onBack(origin: Origin): void
  onOpenItem(feedItemId: number): void
  onOpenFeed(feedId: number): void
}

export function ReaderView({ feedItemId, origin, onBack, onOpenItem, onOpenFeed }: ReaderViewProps) {
  const [itemState, { retry, set: setItem }] = useResource(String(feedItemId), (signal) =>
    fetchReaderItem(feedItemId, signal),
  )
  useScreenTitle(itemState.kind === 'loaded' ? itemState.value.title : undefined)

  useEffect(() => {
    performance.mark(READER_MARKS.entry)
  }, [feedItemId])

  useEffect(() => {
    void preloadArticleMarkdown().then(() => performance.mark(READER_MARKS.rendererReady))
  }, [])

  if (itemState.kind === 'loading' || itemState.kind === 'unavailable' || itemState.kind === 'unreachable') {
    return (
      <div className="view reader">
        <ChromeToolbar>
          <BackButton className="view-back" origin={origin} onBack={onBack} />
        </ChromeToolbar>
        <div className="reader-column">
          {itemState.kind === 'loading' ? (
            <LoadingNote>Opening the item</LoadingNote>
          ) : (
            <LoadFailure subject="The item" kind={itemState.kind} onRetry={retry} />
          )}
        </div>
      </div>
    )
  }

  return (
    <OpenReader
      key={itemState.value.feedItemId}
      item={itemState.value}
      origin={origin}
      onBack={onBack}
      onOpenItem={onOpenItem}
      onOpenFeed={onOpenFeed}
      onSaved={(saved) => setItem((current) => ({ ...current, saved }))}
    />
  )
}

type SourceResult =
  | { readonly source: 'feed-content'; readonly content: FeedContent }
  | { readonly source: 'original-webpage'; readonly content: ReaderArticle }

function OpenReader({
  item,
  origin,
  onBack,
  onOpenItem,
  onOpenFeed,
  onSaved,
}: {
  item: ReaderItem
  origin: Origin
  onBack(origin: Origin): void
  onOpenItem(feedItemId: number): void
  onOpenFeed(feedId: number): void
  onSaved(saved: boolean): void
}) {
  const [viewSource, setViewSource] = useState<ReadingSource>(item.readingSource)
  // The chosen source, unless this Feed Item lacks it and the other one is available.
  const source: ReadingSource =
    viewSource === 'feed-content'
      ? item.feedContent
        ? 'feed-content'
        : 'original-webpage'
      : item.link || !item.feedContent
        ? 'original-webpage'
        : 'feed-content'
  const [preparingStage, setPreparingStage] = useState<ReaderDeadlineStage>()
  const [sourceState, { retry: retrySource }] = useResource(
    `${item.feedItemId} ${source}`,
    async (signal): Promise<SourceResult> => {
      setPreparingStage(undefined)
      if (source === 'feed-content' && item.feedContent) {
        return { source: 'feed-content', content: item.feedContent }
      }
      if (!item.link) throw new Error('the Feed Item has no original link')
      try {
        const content = await fetchArticleThroughDeadlines(item.feedItemId, signal, setPreparingStage)
        return { source: 'original-webpage', content }
      } finally {
        if (!signal.aborted) performance.mark(READER_MARKS.articleResponse)
      }
    },
  )

  const loaded = sourceState.kind === 'loaded' ? sourceState.value : undefined
  const selectedLoaded = loaded?.source === source ? loaded : undefined
  // Feed Content stands in while the Original webpage is pending or has failed.
  const displayed: SourceResult | undefined =
    selectedLoaded ?? (item.feedContent ? { source: 'feed-content', content: item.feedContent } : undefined)
  const next = item.nextInDigest
  const waitingNote = preparingStage ? STAGE_NOTES[preparingStage] : 'Reading the original webpage'
  const waitingContent = item.summary ? (
    <div className="reader-waiting">
      <p className="reader-summary">{item.summary}</p>
      <LoadingNote>{waitingNote}</LoadingNote>
    </div>
  ) : (
    <LoadingNote className="reader-extracting">{waitingNote}</LoadingNote>
  )
  const canSwitchSource = item.link !== null && item.feedContent !== null

  return (
    <article className="view reader">
      <ChromeToolbar>
        <BackButton className="view-back" origin={origin} onBack={onBack} />
        <div className="toolbar-group">
          {item.link ? <OpenOriginal link={item.link} /> : null}
          <SaveToggle feedItemId={item.feedItemId} title={item.title} saved={item.saved} labelled onSaved={onSaved} />
        </div>
      </ChromeToolbar>

      <div className="reader-column">
        <header className="reader-header">
          <h1 className="reader-title">{item.title}</h1>
          <p className="reader-meta">
            <RoutedLink
              className="link reader-feed"
              href={feedPath(item.feedId)}
              onNavigate={() => onOpenFeed(item.feedId)}
            >
              {item.feedTitle}
            </RoutedLink>
            <span className="reader-facts">
              <span>{namedDay(item.date, item.today)}</span>
              {displayed ? <span>{displayed.content.readingTimeMinutes} min read</span> : null}
              {displayed ? <ReadingNote shown={displayed.source} resolved={source} chosen={viewSource} /> : null}
            </span>
            {item.discussionUrl ? <DiscussionLink url={item.discussionUrl} /> : null}
          </p>
          {canSwitchSource ? (
            <Choice
              label="Reading source"
              className="reader-source"
              options={READING_SOURCE_OPTIONS}
              value={viewSource}
              onChange={setViewSource}
            />
          ) : null}
        </header>

        {displayed?.source === 'feed-content' && displayed.content.truncated ? (
          <p className="note reader-truncated" role="status">
            {item.link ? 'Shortened by simple. Open the original for the rest.' : 'Shortened by simple.'}
          </p>
        ) : null}
        {displayed ? (
          <Suspense fallback={<p className="reader-summary">{item.summary}</p>}>
            {/* Keyed by source, so the Original webpage arriving over Feed Content is a
                new article that fades in, never text rewritten under the reader. */}
            <ArticleMarkdown key={displayed.source} markdown={displayed.content.markdown} />
            {selectedLoaded ? <MarkdownCommitted /> : null}
          </Suspense>
        ) : null}
        {sourceState.kind === 'loading' && source === 'original-webpage' ? (
          displayed ? (
            <LoadingNote className="reader-extracting">{waitingNote}</LoadingNote>
          ) : (
            waitingContent
          )
        ) : null}
        {sourceState.kind === 'unavailable' || sourceState.kind === 'unreachable' ? (
          <Fallback
            item={item}
            waitSeconds={waitSecondsOf(sourceState.error)}
            stage={deadlineStage(sourceState.error)}
            onRetry={item.link ? retrySource : undefined}
          />
        ) : null}

        {next ? (
          <section className="reader-next" aria-labelledby="reader-next">
            <h2 className="group-heading" id="reader-next">
              Next in the digest
            </h2>
            <article className="item item-plain">
              <div className="item-meta">
                <span className="item-feed">{next.feedTitle}</span>
                <span className="item-when">{next.displayTime}</span>
              </div>
              <div className="item-body">
                <h3 className="item-title">
                  <RoutedLink href={readerPath(next.feedItemId)} onNavigate={() => onOpenItem(next.feedItemId)}>
                    {next.title}
                  </RoutedLink>
                </h3>
              </div>
            </article>
          </section>
        ) : null}
      </div>
    </article>
  )
}

/**
 * Names the reading on screen only when it is not the one chosen: Feed Content
 * standing in while the Original webpage loads or fails, or the one reading a
 * Feed Item has when the chosen one is missing.
 */
function ReadingNote({
  shown,
  resolved,
  chosen,
}: {
  shown: ReadingSource
  resolved: ReadingSource
  chosen: ReadingSource
}) {
  if (shown !== resolved) return <span>{`${READING_SOURCE_LABELS[shown]} for now`}</span>
  if (resolved !== chosen) return <span>{READING_SOURCE_LABELS[shown]}</span>
  return null
}

/** The Original webpage, in a new tab: it leaves the installation, and says so with ↗. */
function OpenOriginal({ link }: { link: string }) {
  return (
    <a
      className="button reader-original"
      href={link}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="Open original"
    >
      <span className="wide-only">Open original</span>
      <Icon name="external" />
    </a>
  )
}

/** The Discussion the Feed declares, named by its host; it leaves, so it opens a new tab marked ↗. */
function DiscussionLink({ url }: { url: string }) {
  return (
    <span className="reader-discussion">
      <a className="link" href={url} target="_blank" rel="noopener noreferrer">
        Discussion on {new URL(url).hostname}
        <Icon name="external" />
        <span className="visually-hidden"> (opens in a new tab)</span>
      </a>
    </span>
  )
}

const DEFAULT_WAIT_SECONDS = 30

function waitSecondsOf(cause: unknown): number | undefined {
  return cause instanceof ApiError && cause.status === 429
    ? (cause.retryAfterSeconds ?? DEFAULT_WAIT_SECONDS)
    : undefined
}

function deadlineStage(cause: unknown): ReaderDeadlineStage | undefined {
  if (!(cause instanceof ApiError) || cause.code !== 'article_deadline_exceeded') return undefined
  return cause.stage ?? 'publisher'
}

async function fetchArticleThroughDeadlines(
  feedItemId: number,
  signal: AbortSignal,
  onWaiting: (stage: ReaderDeadlineStage) => void,
): Promise<ReaderArticle> {
  for (let refetch = 0; ; refetch += 1) {
    try {
      return await fetchReaderArticle(feedItemId, signal)
    } catch (cause) {
      const stage = deadlineStage(cause)
      if (stage === undefined || refetch >= DEADLINE_REFETCH_ATTEMPTS) throw cause
      onWaiting(stage)
      await pause(DEADLINE_REFETCH_DELAY_MS, signal)
      if (signal.aborted) throw cause
    }
  }
}

function pause(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const finish = () => {
      clearTimeout(timer)
      signal.removeEventListener('abort', finish)
      resolve()
    }
    const timer = setTimeout(finish, milliseconds)
    signal.addEventListener('abort', finish, { once: true })
  })
}

const STAGE_FALLBACKS = {
  publisher: 'The publisher didn’t answer in time.',
  parsing: 'Reading the original webpage took too long.',
} as const satisfies Record<ReaderDeadlineStage, string>

interface FallbackProps {
  readonly item: ReaderItem
  readonly waitSeconds: number | undefined
  readonly stage: ReaderDeadlineStage | undefined
  onRetry: (() => void) | undefined
}

function Fallback({ item, waitSeconds, stage, onRetry }: FallbackProps) {
  if (!item.link && !item.feedContent) {
    return item.summary ? (
      <div className="reader-fallback" role="status">
        <p className="reader-summary">{item.summary}</p>
      </div>
    ) : null
  }

  return (
    <div className="reader-fallback" role="status">
      {!item.feedContent && item.summary ? (
        <p className="reader-summary">{item.summary}</p>
      ) : (
        <p className="note">{stage ? STAGE_FALLBACKS[stage] : 'The original webpage couldn’t be read.'}</p>
      )}
      {item.link || onRetry ? (
        <p className="reader-fallback-actions">
          {onRetry ? (
            <Button className="button" onClick={onRetry}>
              <Icon name="refresh" />
              Retry
            </Button>
          ) : null}
          {item.link ? <OpenOriginal link={item.link} /> : null}
        </p>
      ) : null}
      {waitSeconds !== undefined ? (
        <p className="note">The last try was a moment ago. Wait {waitSeconds} seconds, then retry.</p>
      ) : null}
    </div>
  )
}
