import type { DateKey, DigestGroup, DigestItem } from '../../shared/api.js'
import { storedChoice } from '../stored-choice.js'

export const FIREHOSE_TREATMENT = storedChoice('experimental:firehose', ['fold', 'lane'])
export type FirehoseTreatment = (typeof FIREHOSE_TREATMENT.options)[number]

export type DayRow =
  | { readonly kind: 'item'; readonly item: DigestItem }
  | { readonly kind: 'fold'; readonly feedId: number; readonly items: readonly DigestItem[] }

export interface DaySplit {
  readonly rows: readonly DayRow[]
  readonly lane: readonly DigestItem[]
}

export function splitDay(
  items: readonly DigestItem[],
  isFirehose: (feedId: number) => boolean,
  treatment: FirehoseTreatment,
): DaySplit {
  if (treatment === 'lane') {
    return {
      rows: items.filter((item) => !isFirehose(item.feedId)).map((item) => ({ kind: 'item', item })),
      lane: items.filter((item) => isFirehose(item.feedId)),
    }
  }
  const folds = new Map<number, DigestItem[]>()
  const rows: DayRow[] = []
  for (const item of items) {
    if (!isFirehose(item.feedId)) {
      rows.push({ kind: 'item', item })
      continue
    }
    const fold = folds.get(item.feedId)
    if (fold) {
      fold.push(item)
      continue
    }
    const started = [item]
    folds.set(item.feedId, started)
    rows.push({ kind: 'fold', feedId: item.feedId, items: started })
  }
  return { rows: rows.map(lone), lane: [] }
}

function lone(row: DayRow): DayRow {
  const [only, ...rest] = row.kind === 'fold' ? row.items : []
  return only && rest.length === 0 ? { kind: 'item', item: only } : row
}

export function foldKey(date: DateKey, feedId: number | undefined): string {
  return `fold ${date} ${feedId}`
}

export function timeSpan(items: readonly DigestItem[]): string {
  const latest = items[0]?.displayTime ?? null
  const oldest = items.at(-1)?.displayTime ?? null
  if (latest === null) return ''
  return oldest !== null && oldest !== latest ? `${oldest}–${latest}` : latest
}

export interface ReadingQueue {
  readonly reading: DigestItem
  readonly previous: DigestItem | undefined
  readonly next: readonly DigestItem[]
}

export function queueAround(
  groups: readonly DigestGroup[],
  feedItemId: number,
  isFirehose: (feedId: number) => boolean,
  length: number,
): ReadingQueue | undefined {
  const items = groups.flatMap((group) => group.items)
  const reading = items.find((item) => item.feedItemId === feedItemId)
  if (!reading) return undefined
  const loud = isFirehose(reading.feedId)
  const peers = items.filter((item) => (loud ? item.feedId === reading.feedId : !isFirehose(item.feedId)))
  const at = peers.indexOf(reading)
  return { reading, previous: peers[at - 1], next: peers.slice(at + 1, at + 1 + length) }
}
