import { READING_SOURCES, type ReadingSource } from '../shared/api.js'

export const READING_SOURCE_LABELS = {
  'original-webpage': 'Original webpage',
  'feed-content': 'Feed content',
} as const satisfies Readonly<Record<ReadingSource, string>>

export const READING_SOURCE_OPTIONS = READING_SOURCES.map((source) => ({
  value: source,
  label: READING_SOURCE_LABELS[source],
}))
