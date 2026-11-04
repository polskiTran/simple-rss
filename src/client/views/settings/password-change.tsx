import { Button } from '@base-ui/react/button'
import { useRef, useState, useTransition, type FormEvent } from 'react'
import type { AuthStatus } from '../../../shared/api.js'
import { ApiError, changePassword } from '../../api.js'
import { ActionDialog, DialogCancel } from '../../components/action-dialog.js'
import { Field } from '../../components/field.js'
import { afterEdit, describeFailure, noteOf, reasonOn, reasonToHold, type Feedback } from '../password-failure.js'

type PasswordField = 'current' | 'password' | 'confirmation'

/**
 * Changing the password, as a dialog: it signs every device out, this one
 * included. A reason that belongs to one field goes on it and takes focus there.
 */
export function PasswordChange({ onChanged }: { onChanged(status: AuthStatus): void }) {
  const [open, setOpen] = useState(false)
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [feedback, setFeedback] = useState<Feedback<PasswordField>>()
  const [saving, startSaving] = useTransition()
  const inputs = {
    current: useRef<HTMLInputElement>(null),
    password: useRef<HTMLInputElement>(null),
    confirmation: useRef<HTMLInputElement>(null),
  }

  function refuse(field: PasswordField, reason: string) {
    setFeedback({ field, reason })
    inputs[field].current?.focus()
  }

  function edited(update: (value: string) => void) {
    return (value: string) => {
      update(value)
      setFeedback(afterEdit)
    }
  }

  function openChanged(next: boolean) {
    if (saving) return
    setOpen(next)
    if (next) {
      setCurrentPassword('')
      setNewPassword('')
      setConfirmation('')
      setFeedback(undefined)
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault()
    if (saving) return

    const hold = reasonToHold(newPassword, confirmation)
    if (hold) {
      refuse(hold.field, hold.reason)
      return
    }

    setFeedback(undefined)
    startSaving(async () => {
      try {
        onChanged(await changePassword(currentPassword, newPassword))
      } catch (failure) {
        if (failure instanceof ApiError && failure.code === 'invalid_credentials')
          refuse('current', describeFailure(failure))
        else setFeedback({ note: describeFailure(failure) })
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
          ref={inputs.current}
          value={currentPassword}
          autoComplete="current-password"
          error={reasonOn(feedback, 'current')}
          onChange={edited(setCurrentPassword)}
        />
        <Field
          label="New password"
          type="password"
          ref={inputs.password}
          value={newPassword}
          autoComplete="new-password"
          error={reasonOn(feedback, 'password')}
          onChange={edited(setNewPassword)}
        />
        <Field
          label="Confirm new password"
          type="password"
          ref={inputs.confirmation}
          value={confirmation}
          autoComplete="new-password"
          error={reasonOn(feedback, 'confirmation')}
          onChange={edited(setConfirmation)}
        />
        <p className="note note-error" role="status">
          {noteOf(feedback)}
        </p>
        <div className="dialog-footer">
          <DialogCancel disabled={saving} />
          <Button
            className="button button-primary"
            type="submit"
            focusableWhenDisabled
            disabled={!ready || saving}
            aria-busy={saving}
          >
            {saving ? 'Changing…' : 'Change password'}
          </Button>
        </div>
      </form>
    </ActionDialog>
  )
}
