import { Toggle } from '@base-ui/react/toggle'
import { ToggleGroup } from '@base-ui/react/toggle-group'
import { READING_SOURCES, type ReadingSource } from '../../shared/api.js'

export const READING_SOURCE_LABELS = {
  'original-webpage': 'original webpage',
  'feed-content': 'feed content',
} satisfies Readonly<Record<ReadingSource, string>>

export function ReadingSourceOptions({
  value,
  caption,
  className = '',
  onChange,
}: {
  value: ReadingSource
  caption?: string
  className?: string
  onChange(readingSource: ReadingSource): void
}) {
  return (
    <ToggleGroup
      className={`reading-source-options ${className}`.trim()}
      aria-label="reading source"
      value={[value]}
      onValueChange={(chosen) => {
        const source = READING_SOURCES.find((offered) => offered === chosen[0])
        if (source) onChange(source)
      }}
    >
      {caption ? <span className="reading-source-caption">{caption}</span> : null}
      {READING_SOURCES.map((source) => (
        <Toggle key={source} className="text-button reading-source-option" value={source}>
          {READING_SOURCE_LABELS[source]}
        </Toggle>
      ))}
    </ToggleGroup>
  )
}
