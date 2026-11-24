import { Button } from '@base-ui/react/button'
import { type CSSProperties, type ReactNode, useRef, useState } from 'react'
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

export function useFold<Box extends HTMLElement>(date: DateKey, feedId: number | undefined, kept: number) {
  const [open = false, keepOpen] = useKept(foldKey(date, feedId), z.boolean())
  const box = useRef<Box>(null)
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
      playUnfold(element, heightBefore, kept)
      return
    }
    folding.current = true
    await playFold(element, kept, () => flushSync(() => keepOpen(undefined)))
    folding.current = false
  }
  return { open, box, toggle }
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
  return (
    <div className={layout === 'wall' ? 'x-wall' : 'x-cols'}>
      {rows.map((row, index) => {
        const span = spans[index]
        const style = span ? { '--from': span[0], '--to': span[1] } : undefined
        return row.kind === 'item' ? (
          <Card key={row.item.feedItemId} item={row.item} style={style} actions={actions} />
        ) : (
          <FoldCard key={`fold ${row.feedId}`} date={date} items={row.items} style={style} actions={actions} />
        )
      })}
    </div>
  )
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
    <article className="x-card" style={style} data-saved={item.saved ? '' : undefined}>
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
  const { open, box, toggle } = useFold<HTMLElement>(date, latest?.feedId, 2)
  if (!latest) return null
  const count = counted(items.length, 'Feed Item')
  return (
    <article ref={box} className="x-card" style={style} data-open={open ? '' : undefined}>
      <Button
        className="x-action"
        aria-expanded={open}
        aria-label={`${open ? `Fold ${count}` : count} from ${latest.feedTitle}`}
        onClick={() => void toggle()}
      >
        {open ? `Fold ${count}` : count}
      </Button>
      <Meta item={{ ...latest, displayTime: timeSpan(items) }} actions={actions} />
      {open ? (
        <ol className="x-card-list">
          {items.map((item) => (
            <li key={item.feedItemId}>
              <TitleLink item={item} onOpen={actions.onOpenItem} />
              <span className="x-grey x-num">{item.displayTime}</span>
            </li>
          ))}
        </ol>
      ) : (
        <p className="x-card-summary">Latest: {latest.title}</p>
      )}
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
        {item.displayTime ? <span className="x-grey">, {item.displayTime}</span> : null}
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
