import { Button } from '@base-ui/react/button'
import { useState, type FormEvent } from 'react'
import type { AuthStatus } from '../../shared/api.js'
import { ApiError, claimInstallation } from '../api.js'
import { Field } from '../components/field.js'
import { describeFailure, reasonToHold } from './failure.js'

export interface SetupViewProps {
  onClaimed(status: AuthStatus): void
  /** Called when the server says someone else got here first. */
  onAlreadyClaimed(): void
}

export function SetupView({ onClaimed, onAlreadyClaimed }: SetupViewProps) {
  const [setupSecret, setSetupSecret] = useState('')
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [notice, setNotice] = useState('')
  const [claiming, setClaiming] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (claiming) return

    const hold = reasonToHold(password, confirmation)
    if (hold) {
      setNotice(hold)
      return
    }

    setClaiming(true)
    setNotice('')
    try {
      onClaimed(await claimInstallation(setupSecret, password))
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        onAlreadyClaimed()
        return
      }
      setNotice(
        describeFailure(error, {
          401: 'that setup secret is not right',
          503: 'this installation has no setup secret configured',
        }),
      )
    } finally {
      setClaiming(false)
    }
  }

  return (
    <form className="view measure gate" aria-label="Claim this installation" onSubmit={submit}>
      <p className="empty-note">this installation has no user yet — claim it with its setup secret</p>
      <Field
        label="setup secret"
        type="password"
        value={setupSecret}
        autoComplete="off"
        autoFocus
        onChange={setSetupSecret}
      />
      <Field label="password" type="password" value={password} autoComplete="new-password" onChange={setPassword} />
      <Field
        label="confirm password"
        type="password"
        value={confirmation}
        autoComplete="new-password"
        onChange={setConfirmation}
      />
      <p className="gate-actions">
        <Button className="text-button" type="submit" focusableWhenDisabled disabled={claiming}>
          claim
        </Button>
      </p>
      <p className="notice" role="status">
        {notice}
      </p>
    </form>
  )
}
