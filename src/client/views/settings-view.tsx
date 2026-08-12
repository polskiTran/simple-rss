import { useEffect, useState, type ChangeEvent, type FormEvent } from 'react'
import type { AuthStatus, ServiceMeta } from '../../shared/api.js'
import { changePassword, fetchInstallationPreferences, fetchServiceMeta, signOut, updateInstallationTimezone } from '../api.js'
import { APPEARANCE_OPTIONS, chooseAppearance, storedAppearance, type Appearance } from '../appearance.js'
import { Field } from '../components/field.js'
import { describeFailure, reasonToHold } from './failure.js'

type Version =
  | { readonly kind: 'loading' }
  | { readonly kind: 'loaded'; readonly meta: ServiceMeta }
  | { readonly kind: 'unavailable' }

type Timezone =
  | { readonly kind: 'loading' }
  | { readonly kind: 'loaded'; readonly timezone: string; readonly saving: boolean }
  | { readonly kind: 'unavailable' }

export interface SettingsViewProps {
  onAccessChanged(status: AuthStatus): void
}

// A two-column sheet, not the item shape, so preferences cannot be mistaken
// for reading. The version shows because upgrades are deliberate here — the
// User picks a version rather than following a moving tag.
export function SettingsView({ onAccessChanged }: SettingsViewProps) {
  const [version, setVersion] = useState<Version>({ kind: 'loading' })
  const [changing, setChanging] = useState(false)

  useEffect(() => {
    let current = true
    fetchServiceMeta().then(
      (meta) => current && setVersion({ kind: 'loaded', meta }),
      () => current && setVersion({ kind: 'unavailable' }),
    )
    return () => {
      current = false
    }
  }, [])

  async function leave() {
    try {
      await signOut()
    } finally {
      // However the server answered, this device is finished with the session.
      onAccessChanged({ claimed: true, authenticated: false })
    }
  }

  return (
    <div className="view measure">
      <dl className="sheet">
        <dt className="sheet-label">timezone</dt>
        <dd className="sheet-value">
          <TimezoneChoice />
        </dd>

        <dt className="sheet-label">appearance</dt>
        <dd className="sheet-value">
          <AppearanceChoice />
        </dd>

        <dt className="sheet-label">version</dt>
        <dd className="sheet-value">{describe(version)}</dd>

        <dt className="sheet-label">export</dt>
        <dd className="sheet-value">
          <span className="export-links">
            <a className="export-link" href="/api/subscriptions/export" download="subscriptions.opml">
              subscriptions (OPML)
            </a>
            <a className="export-link" href="/api/export" download="simple-rss-export.json">
              everything (JSON)
            </a>
          </span>
        </dd>

        <dt className="sheet-label">password</dt>
        <dd className="sheet-value">
          <button className="text-button" type="button" onClick={() => setChanging(!changing)}>
            {changing ? 'cancel' : 'change'}
          </button>
        </dd>

        <dt className="sheet-label">session</dt>
        <dd className="sheet-value">
          <button className="text-button" type="button" onClick={leave}>
            sign out
          </button>
        </dd>
      </dl>

      {changing ? <PasswordChange onChanged={onAccessChanged} /> : null}
    </div>
  )
}

// A select, not a free field: the only valid values are the zones this
// runtime already knows.
function TimezoneChoice() {
  const [state, setState] = useState<Timezone>({ kind: 'loading' })
  const [notice, setNotice] = useState('')

  useEffect(() => {
    let current = true
    fetchInstallationPreferences().then(
      ({ timezone }) => current && setState({ kind: 'loaded', timezone, saving: false }),
      () => current && setState({ kind: 'unavailable' }),
    )
    return () => {
      current = false
    }
  }, [])

  if (state.kind === 'loading') return <span>—</span>
  if (state.kind === 'unavailable') return <span>unavailable</span>

  async function change(event: ChangeEvent<HTMLSelectElement>) {
    if (state.kind !== 'loaded' || state.saving) return
    const previous = state.timezone
    const chosen = event.target.value

    setState({ kind: 'loaded', timezone: chosen, saving: true })
    setNotice('')
    try {
      const { timezone } = await updateInstallationTimezone(chosen)
      setState({ kind: 'loaded', timezone, saving: false })
    } catch (error) {
      setState({ kind: 'loaded', timezone: previous, saving: false })
      setNotice(describeFailure(error, { 400: 'that timezone is not recognized' }))
    }
  }

  return (
    <>
      <select
        className="sheet-select"
        aria-label="installation timezone"
        value={state.timezone}
        disabled={state.saving}
        onChange={change}
      >
        {timezoneOptions(state.timezone).map((zone) => (
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

// The stored zone may not be in this runtime's list; keep it selectable.
function timezoneOptions(current: string): string[] {
  const known = typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : []
  return known.includes(current) ? [...known] : [current, ...known]
}

// Same shape as the interval presets. `system` keeps following the device —
// the resting state, not a third theme.
function AppearanceChoice() {
  const [appearance, setAppearance] = useState<Appearance>(storedAppearance)

  function choose(option: Appearance) {
    chooseAppearance(option)
    setAppearance(option)
  }

  return (
    <span className="appearance-options">
      {APPEARANCE_OPTIONS.map((option) => (
        <button
          key={option}
          className="appearance-option"
          type="button"
          aria-pressed={appearance === option}
          onClick={() => choose(option)}
        >
          {option}
        </button>
      ))}
    </span>
  )
}

// Changing the password signs every device out, including this one; the form
// says so before submit, not after.
function PasswordChange({ onChanged }: { onChanged(status: AuthStatus): void }) {
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [notice, setNotice] = useState('')
  const [saving, setSaving] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (saving) return

    const hold = reasonToHold(newPassword, confirmation)
    if (hold) {
      setNotice(hold)
      return
    }

    setSaving(true)
    setNotice('')
    try {
      onChanged(await changePassword(currentPassword, newPassword))
    } catch (error) {
      setNotice(describeFailure(error))
    } finally {
      setSaving(false)
    }
  }

  return (
    <form className="gate" aria-label="Change password" onSubmit={submit}>
      <p className="empty-note">changing the password signs out every device, including this one</p>
      <Field
        label="current password"
        type="password"
        value={currentPassword}
        autoComplete="current-password"
        onChange={setCurrentPassword}
      />
      <Field
        label="new password"
        type="password"
        value={newPassword}
        autoComplete="new-password"
        onChange={setNewPassword}
      />
      <Field
        label="confirm new password"
        type="password"
        value={confirmation}
        autoComplete="new-password"
        onChange={setConfirmation}
      />
      <p className="gate-actions">
        <button className="text-button" type="submit" disabled={saving}>
          change password
        </button>
      </p>
      <p className="notice" role="status">
        {notice}
      </p>
    </form>
  )
}

function describe(version: Version): string {
  switch (version.kind) {
    case 'loading':
      return '—'
    case 'loaded':
      return version.meta.version
    case 'unavailable':
      return 'unavailable'
  }
}
