import { Button } from '@base-ui/react/button'
import { useState, useTransition, type FormEvent } from 'react'
import type { AuthStatus } from '../../../shared/api.js'
import { changePassword } from '../../api.js'
import { ActionDialog, DialogCancel } from '../../components/action-dialog.js'
import { Field } from '../../components/field.js'
import { describeFailure, reasonToHold } from '../password-failure.js'

/** Changing the password, as a dialog: it signs every device out, this one included. */
export function PasswordChange({ onChanged }: { onChanged(status: AuthStatus): void }) {
  const [open, setOpen] = useState(false)
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [notice, setNotice] = useState('')
  const [saving, startSaving] = useTransition()

  function openChanged(next: boolean) {
    if (saving) return
    setOpen(next)
    if (next) {
      setCurrentPassword('')
      setNewPassword('')
      setConfirmation('')
      setNotice('')
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault()
    if (saving) return

    const hold = reasonToHold(newPassword, confirmation)
    if (hold) {
      setNotice(hold)
      return
    }

    setNotice('')
    startSaving(async () => {
      try {
        onChanged(await changePassword(currentPassword, newPassword))
      } catch (error) {
        setNotice(describeFailure(error))
      }
    })
  }

  const ready = currentPassword !== '' && newPassword !== '' && confirmation !== ''
  return (
    <ActionDialog
      open={open}
      title="Change password"
      description="Changing it signs out every device, including this one."
      trigger={<Button className="button">Change password</Button>}
      onOpenChange={openChanged}
    >
      <form className="dialog-body" aria-label="Change password" onSubmit={submit}>
        <Field
          label="Current password"
          type="password"
          value={currentPassword}
          autoComplete="current-password"
          onChange={setCurrentPassword}
        />
        <Field
          label="New password"
          type="password"
          value={newPassword}
          autoComplete="new-password"
          onChange={setNewPassword}
        />
        <Field
          label="Confirm new password"
          type="password"
          value={confirmation}
          autoComplete="new-password"
          onChange={setConfirmation}
        />
        <p className="note note-error" role="status">
          {notice}
        </p>
        <div className="dialog-footer">
          <DialogCancel disabled={saving} />
          <Button className="button button-primary" type="submit" focusableWhenDisabled disabled={!ready || saving}>
            {saving ? 'Changing…' : 'Change password'}
          </Button>
        </div>
      </form>
    </ActionDialog>
  )
}
