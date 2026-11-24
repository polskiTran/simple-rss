import { describe, expect, it } from 'vitest'
import { queueAround, splitDay } from '../../src/client/screens/firehose.js'
import { digestGroup, digestItem } from './fixtures.js'

const LOUD = 9
const isFirehose = (feedId: number) => feedId === LOUD

const day = [
  digestItem({ feedItemId: 1, feedId: LOUD }),
  digestItem({ feedItemId: 2, feedId: 1 }),
  digestItem({ feedItemId: 3, feedId: LOUD }),
  digestItem({ feedItemId: 4, feedId: 2 }),
  digestItem({ feedItemId: 5, feedId: LOUD }),
]

const idsOf = (items: readonly { readonly feedItemId: number }[]) => items.map(({ feedItemId }) => feedItemId)

describe('a Digest day under the Firehose treatments', () => {
  it('folds a Firehose Feed into one row where its latest Feed Item stands, keeping the rest in order', () => {
    const { rows, lane } = splitDay(day, isFirehose, 'fold')

    expect(rows.map((row) => (row.kind === 'fold' ? ['fold', idsOf(row.items)] : row.item.feedItemId))).toEqual([
      ['fold', [1, 3, 5]],
      2,
      4,
    ])
    expect(lane).toEqual([])
  })

  it('leaves a Firehose Feed with one Feed Item that day as a plain row', () => {
    const { rows } = splitDay(day.slice(1, 4), isFirehose, 'fold')

    expect(rows.map((row) => row.kind)).toEqual(['item', 'item', 'item'])
  })

  it('moves every Firehose Feed Item to the Lane in order, and the rest stay rows', () => {
    const { rows, lane } = splitDay(day, isFirehose, 'lane')

    expect(rows.map((row) => (row.kind === 'item' ? row.item.feedItemId : 'fold'))).toEqual([2, 4])
    expect(idsOf(lane)).toEqual([1, 3, 5])
  })
})

describe('the Reader queue', () => {
  const groups = [digestGroup({ items: day })]

  it('skips the Firehose when reading a quiet Feed, and stays inside the Feed when reading a Firehose', () => {
    expect(idsOf(queueAround(groups, 2, isFirehose, 8)?.next ?? [])).toEqual([4])
    expect(queueAround(groups, 3, isFirehose, 8)).toMatchObject({
      previous: { feedItemId: 1 },
      next: [{ feedItemId: 5 }],
    })
  })
})
