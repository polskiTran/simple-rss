import { Button } from '@base-ui/react/button'
import { Suspense, lazy, useEffect, useState } from 'react'
import type { FeedContent, ReaderArticle, ReaderDeadlineStage, ReaderItem, ReadingSource } from '../../shared/api.js'
import { ApiError, fetchReaderArticle, fetchReaderItem } from '../api.js'
import { BackLink } from '../components/back-link.js'
import { FeedTitleLink } from '../components/feed-title-link.js'
import { ItemTitleLink } from '../components/item-title-link.js'
import { LoadingNote } from '../components/loading-note.js'
import { READING_SOURCE_LABELS, ReadingSourceOptions } from '../components/reading-source-options.js'
import { SaveToggle } from '../components/save-toggle.js'
import type { Origin } from '../routing.js'
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
  publisher: 'waiting on the publisher',
  parsing: 'parsing the article',
} as const satisfies Record<ReaderDeadlineStage, string>

export interface ReaderViewProps {
  readonly feedItemId: number
  readonly origin: Origin
  onBack(origin: Origin): void
  onOpenItem(feedItemId: number): void
  onOpenFeed(feedId: number): void
}

export function ReaderView({ feedItemId, origin, onBack, onOpenItem, onOpenFeed }: ReaderViewProps) {
  const [itemState, { set: setItem }] = useResource((signal) => fetchReaderItem(feedItemId, signal), [feedItemId])

  useEffect(() => {
    performance.mark(READER_MARKS.entry)
  }, [feedItemId])

  useEffect(() => {
    void preloadArticleMarkdown().then(() => performance.mark(READER_MARKS.rendererReady))
  }, [])

  if (itemState.kind === 'loading') {
    return <LoadingNote className="view measure empty-note">opening the article</LoadingNote>
  }
  if (itemState.kind === 'unavailable' || itemState.kind === 'unreachable') {
    return (
      <p className="view measure empty-note" role="status">
        {itemState.kind === 'unreachable'
          ? 'the article is out of reach — check the connection, then try again'
          : 'the article is unavailable — try again in a moment'}
      </p>
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
  const [sourceState, { retry: retryParsing }] = useResource(
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
    [item.feedItemId, source],
  )

  const loaded = sourceState.kind === 'loaded' ? sourceState.value : undefined
  const selectedLoaded = loaded?.source === source ? loaded : undefined
  const fallback = !selectedLoaded && item.feedContent ? item.feedContent : undefined
  const displayed = selectedLoaded?.content ?? fallback
  const displayedSource = selectedLoaded?.source ?? (fallback ? 'feed-content' : undefined)
  const showingFeedContent = displayedSource === 'feed-content'
  const next = item.nextInDigest
  const waitingNote = preparingStage ? STAGE_NOTES[preparingStage] : 'parsing the original page'
  const waitingContent = item.summary ? (
    <div className="reader-waiting">
      <p className="reader-summary">{item.summary}</p>
      <LoadingNote className="empty-note">{waitingNote}</LoadingNote>
    </div>
  ) : (
    <LoadingNote className="empty-note reader-extracting">{waitingNote}</LoadingNote>
  )
  const canSwitchSource = item.link !== null && item.feedContent !== null

  return (
    <article className="view measure reader-view">
      <div className="reader-topline">
        <BackLink className="reader-back" origin={origin} onBack={onBack} />
        <SaveToggle feedItemId={item.feedItemId} title={item.title} saved={item.saved} onSaved={onSaved} />
      </div>

      <header className="reader-header">
        <h1 className="reader-title">{item.title}</h1>
        <p className="content-meta reader-meta">
          <FeedTitleLink feedId={item.feedId} title={item.feedTitle} onOpen={onOpenFeed} />
          <span>{item.displayDate}</span>
          {displayed ? <span>{displayed.readingTimeMinutes} min</span> : null}
          {displayedSource ? <span>{READING_SOURCE_LABELS[displayedSource]}</span> : null}
          {item.link ? (
            <a className="reader-original" href={item.link} target="_blank" rel="noopener noreferrer">
              open original
            </a>
          ) : null}
        </p>
        {canSwitchSource ? (
          <ReadingSourceOptions value={viewSource} className="reader-source-options" onChange={setViewSource} />
        ) : null}
      </header>

      {showingFeedContent && item.feedContent?.truncated ? (
        <p className="empty-note" role="status">
          {item.link ? 'shortened by simple — open original for more' : 'shortened by simple'}
        </p>
      ) : null}
      {displayed ? (
        <Suspense fallback={<p className="reader-summary">{item.summary}</p>}>
          <ArticleMarkdown markdown={displayed.markdown} />
          {selectedLoaded ? <MarkdownCommitted /> : null}
        </Suspense>
      ) : null}
      {sourceState.kind === 'loading' && source === 'original-webpage' ? (
        displayed ? (
          <LoadingNote className="empty-note">{waitingNote}</LoadingNote>
        ) : (
          waitingContent
        )
      ) : null}
      {sourceState.kind === 'unavailable' || sourceState.kind === 'unreachable' ? (
        <Fallback
          item={item}
          waitSeconds={waitSecondsOf(sourceState.error)}
          stage={deadlineStage(sourceState.error)}
          onRetry={item.link ? retryParsing : undefined}
        />
      ) : null}

      {next ? (
        <footer className="reader-next">
          <p className="reader-next-label">next in the digest</p>
          <h2 className="content-item-title">
            <ItemTitleLink feedItemId={next.feedItemId} title={next.title} onOpen={onOpenItem} />
          </h2>
          <p className="content-meta">
            <span>{next.feedTitle}</span>
            <span>{next.displayTime}</span>
          </p>
        </footer>
      ) : null}
    </article>
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
  publisher: 'the publisher did not answer in time',
  parsing: 'parsing the article took too long',
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
        <p className="empty-note">
          {stage ? STAGE_FALLBACKS[stage] : 'the original page could not be parsed into an article'}
        </p>
      )}
      {item.link || onRetry ? (
        <p className="reader-fallback-actions">
          {item.link ? (
            <a className="reader-original" href={item.link} target="_blank" rel="noopener noreferrer">
              open original
            </a>
          ) : null}
          {onRetry ? (
            <Button className="text-button" onClick={onRetry}>
              retry parsing
            </Button>
          ) : null}
        </p>
      ) : null}
      {waitSeconds !== undefined ? (
        <p className="empty-note">the last try was a moment ago — wait {waitSeconds}s, then retry</p>
      ) : null}
    </div>
  )
}
