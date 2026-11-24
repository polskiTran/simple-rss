import { READING_SOURCES, type ReaderItem, type ReadingSource } from '../shared/api.js'

export const READING_SOURCE_LABELS = {
  'original-webpage': 'Original webpage',
  'feed-content': 'Feed content',
} as const satisfies Readonly<Record<ReadingSource, string>>

export const READING_SOURCE_OPTIONS = READING_SOURCES.map((source) => ({
  value: source,
  label: READING_SOURCE_LABELS[source],
}))

export function resolvedReadingSource(
  chosen: ReadingSource,
  item: Pick<ReaderItem, 'feedContent' | 'link'>,
): ReadingSource {
  if (chosen === 'feed-content') return item.feedContent ? 'feed-content' : 'original-webpage'
  return item.link || !item.feedContent ? 'original-webpage' : 'feed-content'
}
