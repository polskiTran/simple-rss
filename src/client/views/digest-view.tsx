import { useEffect, useState } from 'react'
import type { Digest } from '../../shared/api.js'
import { DailyBand } from '../components/daily-band.js'
import { fetchDigest } from '../api.js'

type DigestState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'loaded'; readonly digest: Digest }
  | { readonly kind: 'unavailable' }

export function DigestView() {
  const [state, setState] = useState<DigestState>({ kind: 'loading' })

  useEffect(() => {
    let active = true
    void fetchDigest()
      .then((digest) => {
        if (active) setState({ kind: 'loaded', digest })
      })
      .catch(() => {
        if (active) setState({ kind: 'unavailable' })
      })
    return () => {
      active = false
    }
  }, [])

  if (state.kind === 'loading') {
    return <p className="view measure empty-note">loading the digest</p>
  }
  if (state.kind === 'unavailable') {
    return <p className="view measure empty-note">the digest is unavailable</p>
  }
  if (state.digest.groups.length === 0) {
    return <p className="view measure empty-note">nothing yet — subscribe to a Feed to start your digest</p>
  }

  const { today } = state.digest

  return (
    <div className="view measure digest-view digest-view-today">
      <DailyBand date={today.date} volume={today.volume} />
      {state.digest.groups.map((group) => (
        <section className="day-group" aria-labelledby={`day-${group.date}`} key={group.date}>
          <h2
            className={group.label === 'today' ? 'day-heading' : 'day-heading day-heading-past'}
            id={`day-${group.date}`}
          >
            {group.label}
          </h2>
          <div className="content-list">
            {group.items.map((item) => (
              <article className="content-item" key={item.feedItemId}>
                <h3 className="content-item-title">{item.title}</h3>
                <div className="content-meta">
                  <span>{item.feedTitle}</span>
                  <time dateTime={item.publishedAt ?? item.firstSeenAt}>{item.displayTime}</time>
                  <button
                    className="save-placeholder"
                    type="button"
                    aria-label={`save ${item.title}`}
                    disabled
                  >
                    save
                  </button>
                </div>
              </article>
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}
