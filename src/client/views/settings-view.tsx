import { useEffect, useState, type FormEvent } from 'react'
import type { AuthStatus, ServiceMeta } from '../../shared/api.js'
import { changePassword, fetchServiceMeta, signOut } from '../api.js'
import { Field } from '../components/field.js'
import { describeFailure, reasonToHold } from './failure.js'

type Version =
  | { readonly kind: 'loading' }
  | { readonly kind: 'loaded'; readonly meta: ServiceMeta }
  | { readonly kind: 'unavailable' }

export interface SettingsViewProps {
  /** Given the status left behind by signing out or changing the password. */
  onAccessChanged(status: AuthStatus): void
}

/**
 * Settings drops out of the item shape into a two-column sheet, so preferences
 * can never be mistaken for reading.
 *
 * It shows the running version because upgrades are deliberate here — the
 * Owner picks a version rather than following a moving tag — and it holds the
 * two Owner actions that are the only controls in the reader able to end a
 * Session.
 */
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
        <dt className="sheet-label">version</dt>
        <dd className="sheet-value">{describe(version)}</dd>

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

/**
 * Changing the password signs every device out, including this one. The Owner
 * is told that before submitting rather than after, because they may be doing
 * it from a phone with the laptop closed somewhere else.
 */
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
