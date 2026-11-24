import { useState, useTransition } from 'react'
import { fetchInstallationPreferences, updateInstallationTimezone } from '../../api.js'
import { LoadFailure } from '../../components/load-failure.js'
import { NativeSelect } from '../../components/native-select.js'
import { timezoneFailure, timezoneOptions } from '../../timezone.js'
import { useResource } from '../../use-resource.js'

export function TimezoneChoice() {
  const [preferences, { set, retry }] = useResource('preferences', fetchInstallationPreferences)
  const [saving, startSaving] = useTransition()
  const [notice, setNotice] = useState('')

  if (preferences.kind === 'loading') return <span className="note">Loading…</span>
  if (preferences.kind !== 'loaded')
    return <LoadFailure subject="The timezone" kind={preferences.kind} onRetry={retry} />

  const held = preferences.value.timezone

  function change(chosen: string) {
    if (saving) return
    setNotice('')
    set((current) => ({ ...current, timezone: chosen }))
    startSaving(async () => {
      try {
        const updated = await updateInstallationTimezone(chosen)
        set(() => updated)
      } catch (error) {
        set((current) => ({ ...current, timezone: held }))
        setNotice(timezoneFailure(error))
      }
    })
  }

  return (
    <div className="setting-stack">
      <NativeSelect
        label="Installation timezone"
        value={held}
        options={timezoneOptions(held).map((zone) => ({ value: zone, label: zone }))}
        busy={saving}
        onChange={change}
      />
      <p className="note note-error" role="status">
        {notice}
      </p>
    </div>
  )
}
