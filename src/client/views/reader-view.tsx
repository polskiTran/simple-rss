import { Suspense, lazy, useEffect, useState } from 'react'
import type { ReaderArticle, ReaderItem } from '../../shared/api.js'
import { ApiError, fetchReaderArticle, fetchReaderItem } from '../api.js'
import { BackLink } from '../components/back-link.js'
import { FeedTitleLink } from '../components/feed-title-link.js'
import { ItemTitleLink } from '../components/item-title-link.js'
import { LoadingNote } from '../components/loading-note.js'
import { SaveToggle } from '../components/save-toggle.js'
import type { Origin } from '../routing.js'
import { failureKind } from './failure.js'

const ArticleMarkdown = lazy(async () => ({
  default: (await import('../components/article-markdown.js')).ArticleMarkdown,
}))

const parsingNote = <LoadingNote className="empty-note reader-extracting">parsing the original page</LoadingNote>

type ItemState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'loaded'; readonly item: ReaderItem }
  | { readonly kind: 'unavailable' }
  | { readonly kind: 'unreachable' }

type ArticleState =
  | { readonly kind: 'extracting' }
  | { readonly kind: 'ready'; readonly article: ReaderArticle }
  | { readonly kind: 'failed'; readonly waitSeconds: number | undefined }

export interface ReaderViewProps {
  readonly feedItemId: number
  readonly origin: Origin
  onBack(origin: Origin): void
  onOpenItem(feedItemId: number): void
  onOpenFeed(feedId: number): void
}

export function ReaderView({ feedItemId, origin, onBack, onOpenItem, onOpenFeed }: ReaderViewProps) {
  const [itemState, setItemState] = useState<ItemState>({ kind: 'loading' })
  const [articleState, setArticleState] = useState<ArticleState>({ kind: 'extracting' })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let active = true
    setItemState({ kind: 'loading' })
    void fetchReaderItem(feedItemId)
      .then((item) => {
        if (active) setItemState({ kind: 'loaded', item })
      })
      .catch((error: unknown) => {
        if (active) setItemState({ kind: failureKind(error) })
      })
    return () => {
      active = false
    }
  }, [feedItemId])

  useEffect(() => {
    let active = true
    setArticleState({ kind: 'extracting' })
    void fetchReaderArticle(feedItemId)
      .then((article) => {
        if (active) setArticleState({ kind: 'ready', article })
      })
      .catch((error: unknown) => {
        if (active) {
          setArticleState({
            kind: 'failed',
            waitSeconds: error instanceof ApiError && error.status === 429 ? (error.retryAfterSeconds ?? 30) : undefined,
          })
        }
      })
    return () => {
      active = false
    }
  }, [feedItemId, attempt])

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

  const { item } = itemState
  const next = item.nextInDigest
  const setSaved = (saved: boolean) => setItemState({ kind: 'loaded', item: { ...item, saved } })

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
          {articleState.kind === 'ready' ? <span>{articleState.article.readingTimeMinutes} min</span> : null}
          {item.link ? (
            <a className="reader-original" href={item.link} target="_blank" rel="noopener noreferrer">
              open original
            </a>
          ) : null}
        </p>
      </header>

      {articleState.kind === 'extracting' ? parsingNote : null}
      {articleState.kind === 'ready' ? (
        <Suspense fallback={parsingNote}>
          <ArticleMarkdown markdown={articleState.article.markdown} />
        </Suspense>
      ) : null}
      {articleState.kind === 'failed' ? (
        <Fallback item={item} waitSeconds={articleState.waitSeconds} onRetry={() => setAttempt((current) => current + 1)} />
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
        <button className="text-button" type="button" onClick={onRetry}>
          retry parsing
        </button>
      </p>
      {waitSeconds !== undefined ? (
        <p className="empty-note">the last try was a moment ago — wait {waitSeconds}s, then retry</p>
      ) : null}
    </div>
  )
}
