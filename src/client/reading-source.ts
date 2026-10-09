import { READING_SOURCES, type ReadingSource } from '../shared/api.js'

export const READING_SOURCE_LABELS = {
  'original-webpage': 'Original webpage',
  'feed-content': 'Feed content',
} as const satisfies Readonly<Record<ReadingSource, string>>

/** The Reading Source choice, in the API's order: the Feed's preference and the Reader's own switch both offer it. */
export const READING_SOURCE_OPTIONS = READING_SOURCES.map((source) => ({
  value: source,
  label: READING_SOURCE_LABELS[source],
}))
