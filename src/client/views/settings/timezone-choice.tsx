import { useState } from 'react'
import { fetchInstallationPreferences, updateInstallationTimezone } from '../../api.js'
import { NativeSelect } from '../../components/native-select.js'
import { useResource } from '../../use-resource.js'
import { describeFailure } from '../failure.js'

export function TimezoneChoice() {
  const [preferences, { set }] = useResource((signal) => fetchInstallationPreferences(signal), [])
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState('')

  if (preferences.kind === 'loading') return <span className="note">Loading…</span>
  if (preferences.kind !== 'loaded') return <span className="note">Unavailable</span>

  const held = preferences.value.timezone

  async function change(chosen: string) {
    if (saving) return
    setSaving(true)
    setNotice('')
    set((current) => ({ ...current, timezone: chosen }))
    try {
      const updated = await updateInstallationTimezone(chosen)
      set(() => updated)
    } catch (error) {
      set((current) => ({ ...current, timezone: held }))
      setNotice(describeFailure(error, { 400: 'That timezone isn’t recognized.' }))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="setting-stack">
      <NativeSelect
        label="Installation timezone"
        value={held}
        options={timezoneOptions(held).map((zone) => ({ value: zone, label: zone }))}
        disabled={saving}
        onChange={(zone) => void change(zone)}
      />
      <p className="note note-error" role="status">
        {notice}
      </p>
    </div>
  )
}

function timezoneOptions(current: string): string[] {
  const known = typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : []
  return known.includes(current) ? [...known] : [current, ...known]
}
