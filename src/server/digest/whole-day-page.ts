import { gte, lt, type SQL } from 'drizzle-orm'
import type { DigestStart } from '../../shared/api.js'
import { dayAfter, dayKeysIn, dayStartUtc } from '../calendar.js'
import { feedItems } from '../persistence/schema.js'

export const PAGE_SIZE = 50

type NewestFirst<Row> = (conditions: readonly (SQL | undefined)[], limit?: number) => Row[]

export function wholeDayPage<Row extends { readonly chronologyAt: string }>(
  newestFirst: NewestFirst<Row>,
  { from, through }: DigestStart,
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
