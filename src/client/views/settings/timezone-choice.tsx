import { useState, type ChangeEvent } from 'react'
import { fetchInstallationPreferences, updateInstallationTimezone } from '../../api.js'
import { useResource } from '../../use-resource.js'
import { describeFailure } from '../failure.js'

export function TimezoneChoice() {
  const [preferences, { set }] = useResource((signal) => fetchInstallationPreferences(signal), [])
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState('')

  if (preferences.kind === 'loading') return <span>—</span>
  if (preferences.kind !== 'loaded') return <span>unavailable</span>

  const held = preferences.value.timezone

  async function change(event: ChangeEvent<HTMLSelectElement>) {
    if (saving) return
    const chosen = event.target.value

    setSaving(true)
    setNotice('')
    set((current) => ({ ...current, timezone: chosen }))
    try {
      const updated = await updateInstallationTimezone(chosen)
      set(() => updated)
    } catch (error) {
      set((current) => ({ ...current, timezone: held }))
      setNotice(describeFailure(error, { 400: 'that timezone is not recognized' }))
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <select
        className="sheet-select"
        aria-label="installation timezone"
        value={held}
        disabled={saving}
        onChange={change}
      >
        {timezoneOptions(held).map((zone) => (
          <option key={zone} value={zone}>
            {zone}
          </option>
        ))}
      </select>
      {notice ? (
        <p className="notice" role="status">
          {notice}
        </p>
      ) : null}
    </>
  )
}

function timezoneOptions(current: string): string[] {
  const known = typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : []
  return known.includes(current) ? [...known] : [current, ...known]
}
