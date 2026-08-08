import { useEffect, useState } from 'react'
import type { ServiceMeta } from '../../shared/api.js'
import { fetchServiceMeta } from '../api.js'

type State =
  | { readonly kind: 'loading' }
  | { readonly kind: 'loaded'; readonly meta: ServiceMeta }
  | { readonly kind: 'unavailable' }

/**
 * Settings drops out of the item shape into a two-column sheet, so preferences
 * can never be mistaken for reading.
 *
 * It shows the running version because upgrades are deliberate here — the
 * Owner picks a version rather than following a moving tag.
 */
export function SettingsView() {
  const [state, setState] = useState<State>({ kind: 'loading' })

  useEffect(() => {
    let current = true
    fetchServiceMeta().then(
      (meta) => current && setState({ kind: 'loaded', meta }),
      () => current && setState({ kind: 'unavailable' }),
    )
    return () => {
      current = false
    }
  }, [])

  return (
    <div className="view measure">
      <dl className="sheet">
        <dt className="sheet-label">version</dt>
        <dd className="sheet-value">{describe(state)}</dd>
      </dl>
    </div>
  )
}

function describe(state: State): string {
  switch (state.kind) {
    case 'loading':
      return '—'
    case 'loaded':
      return state.meta.version
    case 'unavailable':
      return 'unavailable'
  }
}
