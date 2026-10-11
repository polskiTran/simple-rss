import { gte, lt, type SQL } from 'drizzle-orm'
import type { FeedItemsStart } from '../../shared/api.js'
import { dayAfter, dayKeysIn, dayStartUtc } from '../calendar.js'
import { feedItems } from '../persistence/schema.js'

/** Items a page reaches before completing the day the last one falls on (ADR 0011). */
export const PAGE_SIZE = 50

/**
 * Rows newest first along the chronology under `conditions`, at most `limit`
 * of them when given. The caller owns the query: its joins, columns and scope.
 */
type NewestFirst<Row> = (conditions: readonly (SQL | undefined)[], limit?: number) => Row[]

/**
 * One page of whole installation-timezone days, newest first: from `from`, or
 * from the newest day, as many days as it takes to reach `PAGE_SIZE` items and
 * on through `through` when that day is older still. A busy day comes whole
 * however long it runs; `nextFrom` is the next older day with items.
 */
export function wholeDayPage<Row extends { readonly chronologyAt: string }>(
  newestFirst: NewestFirst<Row>,
  { from, through }: FeedItemsStart,
  timezone: string,
) {
  const dayOf = dayKeysIn(timezone)
  const before = from ? lt(feedItems.chronologyAt, dayStartUtc(dayAfter(from), timezone).toISOString()) : undefined

  const head = newestFirst([before], PAGE_SIZE)
  const last = head.at(-1)
  if (!last || head.length < PAGE_SIZE) return { rows: head, nextFrom: null }

  const lastOpening = dayStartUtc(dayOf(last.chronologyAt), timezone).toISOString()
  const throughOpening = through ? dayStartUtc(through, timezone).toISOString() : lastOpening
  const opening = throughOpening < lastOpening ? throughOpening : lastOpening
  const older = newestFirst([lt(feedItems.chronologyAt, opening)], 1)[0]
  return {
    rows: newestFirst([before, gte(feedItems.chronologyAt, opening)]),
    nextFrom: older ? dayOf(older.chronologyAt) : null,
  }
}
