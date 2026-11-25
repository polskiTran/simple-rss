import { Button } from '@base-ui/react/button'
import { type CSSProperties, type ReactNode, useLayoutEffect, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { z } from 'zod'
import type { DateKey, DigestItem } from '../../shared/api.js'
import { counted } from '../day-names.js'
import { playFold, playUnfold } from '../motion.js'
import { useKept } from '../routing.js'
import { storedChoice } from '../stored-choice.js'
import { type DayRow, foldKey, timeSpan } from './firehose.js'
import { FeedLink, SaveWord, TitleLink, useRhythmOf } from '../components/ledger.js'

export const DIGEST_LAYOUT = storedChoice('digest-layout', ['index', 'columns', 'wall'])
export type DigestLayout = (typeof DIGEST_LAYOUT.options)[number]
export const LAYOUT_LABELS = { index: 'Index', columns: 'Columns', wall: 'Wall' } as const satisfies Record<
  DigestLayout,
  string
>

export function useFold<Box extends HTMLElement, Kept extends HTMLElement>(date: DateKey, feedId: number | undefined) {
  const [open = false, keepOpen] = useKept(foldKey(date, feedId), z.boolean())
  const box = useRef<Box>(null)
  const kept = useRef<Kept>(null)
  const folding = useRef(false)
  const toggle = async () => {
    const element = box.current
    if (folding.current) return
    if (!element) {
      keepOpen(open ? undefined : true)
      return
    }
    if (!open) {
      const heightBefore = element.offsetHeight
      flushSync(() => keepOpen(true))
      playUnfold(element, kept.current, heightBefore)
      return
    }
    folding.current = true
    await playFold(element, kept.current, () => flushSync(() => keepOpen(undefined)))
    folding.current = false
  }
  return { open, box, kept, toggle }
}

export function FoldToggle({
  open,
  count,
  feedTitle,
  latest,
  onToggle,
}: {
  readonly open: boolean
  readonly count: string
  readonly feedTitle: string
  readonly latest?: string
  onToggle(): void
}) {
  return (
    <Button
      className="x-fold-toggle"
      aria-expanded={open}
      aria-label={`${open ? `Fold ${count}` : count} from ${feedTitle}`}
      onClick={onToggle}
    >
      <span className={open ? undefined : 'x-fold-word'}>{count}</span>
      {open ? (
        <span key="fold" className="x-fold-hint x-fold-word">
          Fold
        </span>
      ) : latest === undefined ? null : (
        <span key="latest" className="x-fold-hint">
          {latest}
        </span>
      )}
    </Button>
  )
}

export interface RowActions {
  onOpenItem(feedItemId: number): void
  onOpenFeed(feedId: number): void
  onSaved(feedItemId: number, saved: boolean): void
}

const HANGS = [
  [
    [1, 6],
    [7, 10],
    [11, 13],
  ],
  [
    [2, 5],
    [6, 12],
  ],
  [
    [1, 4],
    [5, 8],
    [9, 13],
  ],
  [
    [3, 8],
    [10, 13],
  ],
] as const

function wallSpans(count: number, start: number): readonly (readonly [number, number])[] {
  const spans: (readonly [number, number])[] = []
  for (let row = start; spans.length < count; row++) spans.push(...(HANGS[row % HANGS.length] ?? []))
  return spans.slice(0, count)
}

export function Pictures({
  layout,
  date,
  rows,
  actions,
}: {
  readonly layout: Exclude<DigestLayout, 'index'>
  readonly date: DateKey
  readonly rows: readonly DayRow[]
  readonly actions: RowActions
}) {
  const spans = layout === 'wall' ? wallSpans(rows.length, Number(date.slice(8))) : []
  const cards = rows.map((row, index) => {
    const span = spans[index]
    const style = span ? { '--from': span[0], '--to': span[1] } : undefined
    return row.kind === 'item' ? (
      <Card key={row.item.feedItemId} item={row.item} style={style} actions={actions} />
    ) : (
      <FoldCard key={`fold ${row.feedId}`} date={date} items={row.items} style={style} actions={actions} />
    )
  })
  return layout === 'wall' ? <div className="x-wall">{cards}</div> : <Stacks cards={cards} />
}

function Stacks({ cards }: { readonly cards: readonly ReactNode[] }) {
  const columns = useRef<HTMLDivElement>(null)
  const [count, setCount] = useState(1)
  useLayoutEffect(() => {
    const element = columns.current
    if (!element) return
    const measure = () => setCount(stackCount(element))
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  return (
    <div ref={columns} className="x-cols">
      {Array.from({ length: count }, (_, stack) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: a stack is its position; the cards in it keep their own keys
        <div key={stack}>{cards.filter((_, index) => index % count === stack)}</div>
      ))}
    </div>
  )
}

function stackCount(columns: HTMLElement): number {
  const style = getComputedStyle(columns)
  const gap = Number.parseFloat(style.columnGap) || 0
  const narrowest = Number.parseFloat(style.getPropertyValue('--x-stack-narrowest'))
  const most = Number.parseFloat(style.getPropertyValue('--x-stack-most'))
  const fitting = Math.floor((columns.clientWidth + gap) / (narrowest + gap))
  return Number.isFinite(fitting) && Number.isFinite(most) ? Math.max(1, Math.min(most, fitting)) : 1
}

function Card({
  item,
  style,
  actions,
}: {
  readonly item: DigestItem
  readonly style: CSSProperties | undefined
  readonly actions: RowActions
}) {
  return (
    <article className="x-card" style={style}>
      <Picture src={item.imageUrl} />
      <TitleLink item={item} onOpen={actions.onOpenItem} />
      <Meta item={item} actions={actions}>
        <SaveWord item={item} onSaved={(saved) => actions.onSaved(item.feedItemId, saved)} />
      </Meta>
      {item.summary ? <p className="x-card-summary">{item.summary}</p> : null}
    </article>
  )
}

function FoldCard({
  date,
  items,
  style,
  actions,
}: {
  readonly date: DateKey
  readonly items: readonly DigestItem[]
  readonly style: CSSProperties | undefined
  readonly actions: RowActions
}) {
  const [latest] = items
  const { open, box, kept, toggle } = useFold<HTMLElement, HTMLLIElement>(date, latest?.feedId)
  if (!latest) return null
  return (
    <article ref={box} className="x-card x-fold-card" style={style} data-open={open ? '' : undefined}>
      <FoldToggle
        open={open}
        count={counted(items.length, 'Feed Item')}
        feedTitle={latest.feedTitle}
        onToggle={() => void toggle()}
      />
      <Meta item={{ ...latest, displayTime: timeSpan(items) }} actions={actions} />
      <ol className="x-card-list">
        {(open ? items : [latest]).map((item) => (
          <li key={item.feedItemId} ref={item === latest ? kept : undefined}>
            <TitleLink item={item} onOpen={actions.onOpenItem} />
            <span className="x-grey x-num x-time">{item.displayTime}</span>
          </li>
        ))}
      </ol>
    </article>
  )
}

function Meta({
  item,
  actions,
  children,
}: {
  readonly item: Pick<DigestItem, 'feedId' | 'feedTitle' | 'displayTime'>
  readonly actions: RowActions
  readonly children?: ReactNode
}) {
  const rhythmOf = useRhythmOf()
  return (
    <div className="x-card-meta">
      <span className="x-card-source">
        <FeedLink
          feedId={item.feedId}
          title={item.feedTitle}
          rhythm={rhythmOf(item.feedId)}
          onOpen={actions.onOpenFeed}
        />
        {item.displayTime ? <span className="x-grey x-time">, {item.displayTime}</span> : null}
      </span>
      {children}
    </div>
  )
}

function Picture({ src }: { readonly src: string | null }) {
  const [failed, setFailed] = useState(false)
  if (src === null || failed) return null
  return <img className="x-picture" src={src} alt="" loading="lazy" decoding="async" onError={() => setFailed(true)} />
}
