import { fetchServiceMeta } from '../../api.js'
import { useResource } from '../../use-resource.js'

/** The running installation's version, as one line of the settings sheet. */
export function VersionNote() {
  const [meta] = useResource((signal) => fetchServiceMeta(signal), [])

  if (meta.kind === 'loading') return '—'
  if (meta.kind !== 'loaded') return 'unavailable'
  return meta.value.version
}
