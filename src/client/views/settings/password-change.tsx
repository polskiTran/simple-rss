import { useState, type FormEvent } from 'react'
import type { AuthStatus } from '../../../shared/api.js'
import { changePassword } from '../../api.js'
import { Field } from '../../components/field.js'
import { describeFailure, reasonToHold } from '../failure.js'

export function PasswordChange({ onChanged }: { onChanged(status: AuthStatus): void }) {
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
