import { Button } from '@base-ui/react/button'
import { Suspense, lazy, useEffect } from 'react'
import type { ReaderItem } from '../../shared/api.js'
import { ApiError, fetchReaderArticle, fetchReaderItem } from '../api.js'
import { BackLink } from '../components/back-link.js'
import { FeedTitleLink } from '../components/feed-title-link.js'
import { ItemTitleLink } from '../components/item-title-link.js'
import { LoadingNote } from '../components/loading-note.js'
import { SaveToggle } from '../components/save-toggle.js'
import type { Origin } from '../routing.js'
import { useResource } from '../use-resource.js'

const preloadArticleMarkdown = () => import('../components/article-markdown.js')
const ArticleMarkdown = lazy(async () => ({
  default: (await preloadArticleMarkdown()).ArticleMarkdown,
}))

const parsingNote = <LoadingNote className="empty-note reader-extracting">parsing the original page</LoadingNote>

export interface ReaderViewProps {
  readonly feedItemId: number
  readonly origin: Origin
  onBack(origin: Origin): void
  onOpenItem(feedItemId: number): void
  onOpenFeed(feedId: number): void
}

export function ReaderView({ feedItemId, origin, onBack, onOpenItem, onOpenFeed }: ReaderViewProps) {
  const [itemState, { set: setItem }] = useResource((signal) => fetchReaderItem(feedItemId, signal), [feedItemId])
  const [articleState, { retry: retryParsing }] = useResource(
    (signal) => fetchReaderArticle(feedItemId, signal),
    [feedItemId],
  )

  useEffect(() => {
    void preloadArticleMarkdown()
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

  const item = itemState.value
  const next = item.nextInDigest
  const setSaved = (saved: boolean) => setItem((current) => ({ ...current, saved }))
  const waitingContent = item.summary ? (
    <div className="reader-waiting">
      <p className="reader-summary">{item.summary}</p>
      <LoadingNote className="empty-note">parsing the original page</LoadingNote>
    </div>
  ) : (
    parsingNote
  )

  return (
    <article className="view measure reader-view">
      <div className="reader-topline">
        <BackLink className="reader-back" origin={origin} onBack={onBack} />
        <SaveToggle feedItemId={item.feedItemId} title={item.title} saved={item.saved} onSaved={setSaved} />
      </div>

      <header className="reader-header">
        <h1 className="reader-title">{item.title}</h1>
        <p className="content-meta reader-meta">
          <FeedTitleLink feedId={item.feedId} title={item.feedTitle} onOpen={onOpenFeed} />
          <span>{item.displayDate}</span>
          {articleState.kind === 'loaded' ? <span>{articleState.value.readingTimeMinutes} min</span> : null}
          {item.link ? (
            <a className="reader-original" href={item.link} target="_blank" rel="noopener noreferrer">
              open original
            </a>
          ) : null}
        </p>
      </header>

      {articleState.kind === 'loading' ? waitingContent : null}
      {articleState.kind === 'loaded' ? (
        <Suspense fallback={waitingContent}>
          <ArticleMarkdown markdown={articleState.value.markdown} />
        </Suspense>
      ) : null}
      {articleState.kind === 'unavailable' || articleState.kind === 'unreachable' ? (
        <Fallback item={item} waitSeconds={waitSecondsOf(articleState.error)} onRetry={retryParsing} />
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

interface FallbackProps {
  readonly item: ReaderItem
  readonly waitSeconds: number | undefined
  onRetry(): void
}

function Fallback({ item, waitSeconds, onRetry }: FallbackProps) {
  return (
    <div className="reader-fallback" role="status">
      {item.summary ? (
        <p className="reader-summary">{item.summary}</p>
      ) : (
        <p className="empty-note">the original page could not be parsed into an article</p>
      )}
      <p className="reader-fallback-actions">
        {item.link ? (
          <a className="reader-original" href={item.link} target="_blank" rel="noopener noreferrer">
            open original
          </a>
        ) : null}
        <Button className="text-button" onClick={onRetry}>
          retry parsing
        </Button>
      </p>
      {waitSeconds !== undefined ? (
        <p className="empty-note">the last try was a moment ago — wait {waitSeconds}s, then retry</p>
      ) : null}
    </div>
  )
}
