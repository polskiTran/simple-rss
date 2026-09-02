import { cadenceLevel } from '../cadence.js'

export function CadenceStrip({ counts, title }: { counts: readonly number[]; title: string }) {
  const total = counts.reduce((sum, count) => sum + count, 0)
  return (
    <span className="cadence-strip" role="img" aria-label={`${total} items from ${title} in the last 30 days`}>
      {counts.map((count, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: counts is a fixed window of consecutive days — the cell's position is the day it stands for.
        <span className="cadence-day" data-level={cadenceLevel(count)} key={index} aria-hidden="true" />
      ))}
    </span>
  )
}
