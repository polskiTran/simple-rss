import { Group } from './group.js'

export interface FeedFilterProps {
  /** Ties the heading to its section; unique on the page. */
  readonly id: string
  readonly title: string
  readonly feeds: readonly { feedId: number; title: string; count: number }[]
  readonly shown: ReadonlySet<number>
  onChange(shown: ReadonlySet<number>): void
}

/**
 * Ticked Feeds narrow a list to themselves; none ticked shows all of it. Beside
 * the list on a wide screen, a row of chips above it on a phone.
 */
export function FeedFilter({ id, title, feeds, shown, onChange }: FeedFilterProps) {
  const toggle = (feedId: number) => {
    const next = new Set(shown)
    if (next.has(feedId)) next.delete(feedId)
    else next.add(feedId)
    onChange(next)
  }

  return (
    <aside className="feed-filter" aria-label="Narrow by feed">
      <Group
        id={id}
        title={title}
        count={feeds.length}
        className="panel"
        aside={
          shown.size > 0 ? (
            <button type="button" className="button button-ghost button-small" onClick={() => onChange(new Set())}>
              Clear
            </button>
          ) : undefined
        }
      >
        <ul className="filter-list">
          {feeds.map((feed) => (
            <li key={feed.feedId}>
              <label className="filter-row">
                <input
                  type="checkbox"
                  className="checkbox"
                  checked={shown.has(feed.feedId)}
                  onChange={() => toggle(feed.feedId)}
                />
                <span className="filter-name">{feed.title}</span>
                <span className="filter-count">{feed.count}</span>
              </label>
            </li>
          ))}
        </ul>
      </Group>
    </aside>
  )
}
