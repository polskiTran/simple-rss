import { Button } from '@base-ui/react/button'
import { lazy, Suspense, useEffect, useEffectEvent, useState } from 'react'
import {
  type DigestStart,
  type FeedContent,
  type ReaderArticle,
  type ReaderDeadlineStage,
  type ReaderItem,
  type ReadingSource,
  utcDayKey,
} from '../../shared/api.js'
import { useScreenTitle } from '../arrival.js'
import { fetchDigest, fetchReaderItem } from '../api.js'
import { editable } from '../components/global-search.js'
import { RoutedLink } from '../components/routed-link.js'
import { SaveToggle } from '../components/save-toggle.js'
import { dayTitle } from '../day-names.js'
import { READING_SOURCE_LABELS, READING_SOURCE_OPTIONS } from '../reading-source.js'
import { type Origin, readerPath } from '../routing.js'
import { storedChoice, useStoredChoice } from '../stored-choice.js'
import { useResource, valueInView } from '../use-resource.js'
import { fetchArticleThroughDeadlines, resolvedReadingSource, STAGE_NOTES } from '../views/reader-view.js'
import { queueAround } from './firehose.js'
import { FeedLink, Options, useRhythmOf } from './parts.js'

const ArticleMarkdown = lazy(async () => ({
  default: (await import('../components/article-markdown.js')).ArticleMarkdown,
}))

const TEXT_SIZE = storedChoice('experimental:text-size', ['medium', 'small', 'large'])
const TEXT_SIZE_LABELS = { small: 'Small', medium: 'Medium', large: 'Large' } as const satisfies Record<
  (typeof TEXT_SIZE.options)[number],
  string
>

const TEXT_SIZES = ['small', 'medium', 'large'] as const satisfies readonly (typeof TEXT_SIZE.options)[number][]

const QUEUE_LENGTH = 8

interface ReaderScreenProps {
  readonly feedItemId: number
  readonly origin: Origin
  onBack(origin: Origin): void
  onStep(feedItemId: number): void
  onOpenFeed(feedId: number): void
}

export function ReaderScreen({ feedItemId, origin, onBack, onStep, onOpenFeed }: ReaderScreenProps) {
  const [state, { retry, set }] = useResource(String(feedItemId), (signal) => fetchReaderItem(feedItemId, signal))
  useScreenTitle(state.kind === 'loaded' ? state.value.title : undefined)

  if (state.kind !== 'loaded') {
    return (
      <div className="x-screen x-reader x-grid">
        <div className="x-reader-label">
          <BackLink origin={origin} onBack={onBack} />
        </div>
        <div className="x-reader-main">
          {state.kind === 'loading' ? (
            <p className="x-grey">Opening the Feed Item</p>
          ) : (
            <p>
              The Feed Item didn’t load.{' '}
              <Button className="x-more" onClick={retry}>
                Retry
              </Button>
            </p>
          )}
        </div>
      </div>
    )
  }

  return (
    <OpenReader
      key={state.value.feedItemId}
      item={state.value}
      origin={origin}
      onBack={onBack}
      onStep={onStep}
      onOpenFeed={onOpenFeed}
      onSaved={(saved) => set((current) => ({ ...current, saved }))}
    />
  )
}

type Shown =
  | { readonly source: 'feed-content'; readonly content: FeedContent }
  | { readonly source: 'original-webpage'; readonly content: ReaderArticle }

interface NextItem {
  readonly feedItemId: number
  readonly title: string
  readonly feedId: number | undefined
  readonly feedTitle: string
  readonly displayTime: string | null
}

function OpenReader({
  item,
  origin,
  onBack,
  onStep,
  onOpenFeed,
  onSaved,
}: Omit<ReaderScreenProps, 'feedItemId'> & { readonly item: ReaderItem; onSaved(saved: boolean): void }) {
  const rhythmOf = useRhythmOf()
  const textSize = useStoredChoice(TEXT_SIZE)
  const [chosen, setChosen] = useState<ReadingSource>(item.readingSource)
  const source = resolvedReadingSource(chosen, item)
  const [sourceState, { retry: retrySource }] = useResource<Shown, ReaderDeadlineStage>(
    `${item.feedItemId} ${source}`,
    async (signal, report) => {
      if (source === 'feed-content' && item.feedContent) return { source, content: item.feedContent }
      if (!item.link) throw new Error('the Feed Item has no original link')
      return {
        source: 'original-webpage',
        content: await fetchArticleThroughDeadlines(item.feedItemId, signal, report),
      }
    },
  )
  const [digestState] = useResource(`around ${item.date}`, (signal) => fetchDigest(daysAround(item), signal))
  const around = valueInView(digestState)
  const queue = around
    ? queueAround(around.groups, item.feedItemId, (feedId) => rhythmOf(feedId) === 'firehose', QUEUE_LENGTH)
    : undefined
  const nextFromServer: readonly NextItem[] = item.nextInDigest ? [{ ...item.nextInDigest, feedId: undefined }] : []
  const next = queue && queue.next.length > 0 ? queue.next : nextFromServer
  const [following] = next
  const previous = queue?.previous

  const failed = sourceState.kind === 'unavailable' || sourceState.kind === 'unreachable'
  const loaded = sourceState.kind === 'loaded' && sourceState.value.source === source ? sourceState.value : undefined
  const fallback = (source === 'feed-content' || failed) && item.feedContent ? item.feedContent : undefined
  const shown: Shown | undefined = loaded ?? (fallback ? { source: 'feed-content', content: fallback } : undefined)
  const stage = sourceState.kind === 'loading' ? sourceState.progress : undefined
  const [article, setArticle] = useState<HTMLElement | null>(null)

  const key = useEffectEvent((event: KeyboardEvent) => {
    if (event.altKey || event.ctrlKey || event.metaKey || editable(event.target)) return
    if (event.key === 'j' && following) onStep(following.feedItemId)
    else if (event.key === 'k' && previous) onStep(previous.feedItemId)
    else if (event.key === 'Escape') onBack(origin)
  })
  useEffect(() => {
    document.addEventListener('keydown', key)
    return () => document.removeEventListener('keydown', key)
  }, [])

  const time = queue?.reading.displayTime
  return (
    <article className="x-screen x-reader x-grid" data-text={textSize}>
      <div className="x-reader-label">
        <BackLink origin={origin} onBack={onBack} />
        <div>
          <FeedLink feedId={item.feedId} title={item.feedTitle} rhythm={rhythmOf(item.feedId)} onOpen={onOpenFeed} />
        </div>
        <div className="x-grey">
          {dayTitle(item.date, item.today)}
          {time ? `, ${time}` : ''}
        </div>
        {shown ? (
          <div className="x-grey">
            {shown.content.readingTimeMinutes} min read
            {shown.source === 'feed-content' && shown.content.truncated ? ', shortened' : ''}
          </div>
        ) : null}
        <div className="x-reader-gap">
          <SaveToggle
            className="x-save x-save-shown"
            feedItemId={item.feedItemId}
            title={item.title}
            saved={item.saved}
            onSaved={onSaved}
          />
        </div>
        {item.discussionUrl ? (
          <div>
            <a className="x-grey x-link" href={item.discussionUrl} target="_blank" rel="noopener noreferrer">
              Discussion
            </a>
          </div>
        ) : null}
        {item.link ? (
          <div>
            <a className="x-grey x-link" href={item.link} target="_blank" rel="noopener noreferrer">
              Open the Original webpage
            </a>
          </div>
        ) : null}
        {item.link ? <CopyLink link={item.link} /> : null}
        <Options
          label="Reading Source"
          className="x-reader-gap"
          options={READING_SOURCE_OPTIONS.map((option) => ({
            ...option,
            disabled: option.value === 'feed-content' ? !item.feedContent : !item.link,
          }))}
          value={source}
          onChange={setChosen}
        />
        {shown && shown.source !== source ? (
          <div className="x-grey">{READING_SOURCE_LABELS[shown.source]} for now</div>
        ) : null}
        <Options
          label="Text size"
          options={TEXT_SIZES.map((size) => ({ value: size, label: TEXT_SIZE_LABELS[size] }))}
          value={textSize}
          onChange={TEXT_SIZE.choose}
        />
        <ReadProgress />
      </div>

      <div className="x-reader-main">
        <h1 className="x-reader-title">{item.title}</h1>
        <div ref={setArticle} className="x-prose">
          {shown ? (
            <Suspense fallback={null}>
              <ArticleMarkdown key={shown.source} markdown={shown.content.markdown} />
            </Suspense>
          ) : null}
        </div>
        {sourceState.kind === 'loading' && source === 'original-webpage' ? (
          <p className="x-grey x-reader-waiting">{stage ? STAGE_NOTES[stage] : 'Reading the Original webpage'}</p>
        ) : null}
        {failed && source === 'original-webpage' ? (
          <p className="x-reader-failed" role="status">
            The Original webpage couldn’t be read.{' '}
            {item.link ? (
              <>
                <Button className="x-more" onClick={retrySource}>
                  Retry
                </Button>{' '}
                <a className="x-link" href={item.link} target="_blank" rel="noopener noreferrer">
                  Open the Original webpage
                </a>
              </>
            ) : null}
          </p>
        ) : null}
      </div>

      <Outline article={article} />

      {following ? (
        <RoutedLink
          className="x-legend x-grid x-reader-next"
          href={readerPath(following.feedItemId)}
          onNavigate={() => onStep(following.feedItemId)}
        >
          <span className="x-c-label">Next</span>
          <span className="x-c-main">{following.title}</span>
          <span
            className="x-c-side x-feed"
            data-rhythm={following.feedId === undefined ? 'inactive' : rhythmOf(following.feedId)}
          >
            {following.feedTitle}
          </span>
          <span className="x-c-end">{following.displayTime}</span>
        </RoutedLink>
      ) : null}
    </article>
  )
}

const DAY_MS = 86_400_000

function daysAround({ date, today }: Pick<ReaderItem, 'date' | 'today'>): DigestStart {
  const after = utcDayKey(Date.parse(`${date}T12:00:00Z`) + DAY_MS)
  return after > today ? { from: date } : { from: after, through: date }
}

function BackLink({ origin, onBack }: { readonly origin: Origin; onBack(origin: Origin): void }) {
  return (
    <div>
      <RoutedLink className="x-grey x-link" href={origin.path} onNavigate={() => onBack(origin)}>
        {origin.label ?? 'Back'}
      </RoutedLink>
    </div>
  )
}

function CopyLink({ link }: { readonly link: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <div>
      <Button
        className="x-grey x-link"
        onClick={() => {
          void navigator.clipboard?.writeText(link).then(() => setCopied(true))
        }}
      >
        {copied ? 'Copied' : 'Copy link'}
      </Button>
    </div>
  )
}

function ReadProgress() {
  const [percent, setPercent] = useState<number>()
  useEffect(() => {
    let frame = 0
    const measure = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        const room = document.documentElement.scrollHeight - window.innerHeight
        setPercent(room > 0 ? Math.min(100, Math.round((100 * window.scrollY) / room)) : undefined)
      })
    }
    measure()
    window.addEventListener('scroll', measure, { passive: true })
    window.addEventListener('resize', measure)
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('scroll', measure)
      window.removeEventListener('resize', measure)
    }
  }, [])
  return <div className="x-grey x-num">{percent === undefined ? null : `${percent}% read`}</div>
}

interface Heading {
  readonly id: string
  readonly text: string
  readonly sub: boolean
}

const OUTLINE_FROM = 3

function Outline({ article }: { readonly article: HTMLElement | null }) {
  const [headings, setHeadings] = useState<readonly Heading[]>([])
  const [current, setCurrent] = useState<string>()

  useEffect(() => {
    if (!article) return
    const collect = () => {
      const found = [...article.querySelectorAll<HTMLElement>('h2, h3')].map((element, index) => {
        element.id = `x-section-${index + 1}`
        return { id: element.id, text: element.textContent ?? '', sub: element.tagName === 'H3' }
      })
      setHeadings((shown) =>
        shown.length === found.length && shown.every((heading, index) => heading.text === found[index]?.text)
          ? shown
          : found,
      )
    }
    collect()
    const observer = new MutationObserver(collect)
    observer.observe(article, { childList: true, subtree: true })
    return () => observer.disconnect()
  }, [article])

  useEffect(() => {
    if (!article || headings.length < OUTLINE_FROM) return
    const track = () => {
      const line = window.innerHeight * 0.3
      const passed = headings.filter(
        ({ id }) => (document.getElementById(id)?.getBoundingClientRect().top ?? line) < line,
      )
      setCurrent(passed.at(-1)?.id)
    }
    track()
    window.addEventListener('scroll', track, { passive: true })
    return () => window.removeEventListener('scroll', track)
  }, [article, headings])

  if (headings.length < OUTLINE_FROM) return null
  return (
    <nav className="x-reader-outline" aria-label="Contents">
      <p className="x-grey">Contents</p>
      {headings.map((heading) => (
        <button
          key={heading.id}
          type="button"
          data-sub={heading.sub ? '' : undefined}
          aria-current={heading.id === current ? 'location' : undefined}
          onClick={() => document.getElementById(heading.id)?.scrollIntoView({ block: 'start' })}
        >
          {heading.text}
        </button>
      ))}
    </nav>
  )
}
