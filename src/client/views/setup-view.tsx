import { Button } from '@base-ui/react/button'
import { useState, useTransition, type FormEvent } from 'react'
import { useScreenTitle } from '../arrival.js'
import type { AuthStatus } from '../../shared/api.js'
import { ApiError, claimInstallation } from '../api.js'
import { Field } from '../components/field.js'
import { describeFailure, reasonToHold } from './password-failure.js'

interface SetupViewProps {
  onClaimed(status: AuthStatus): void
  /** Called when the server says someone else got here first. */
  onAlreadyClaimed(): void
}

export function SetupView({ onClaimed, onAlreadyClaimed }: SetupViewProps) {
  useScreenTitle('Set up')
  const [setupSecret, setSetupSecret] = useState('')
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [notice, setNotice] = useState('')
  const [claiming, startClaiming] = useTransition()

  function submit(event: FormEvent) {
    event.preventDefault()
    if (claiming) return

    const hold = reasonToHold(password, confirmation)
    if (hold) {
      setNotice(hold)
      return
    }

    setNotice('')
    startClaiming(async () => {
      try {
        onClaimed(await claimInstallation(setupSecret, password))
      } catch (error) {
        if (error instanceof ApiError && error.code === 'already_claimed') {
          onAlreadyClaimed()
          return
        }
        setNotice(
          describeFailure(error, {
            invalid_credentials: 'That setup secret isn’t right.',
            setup_unavailable: 'This installation has no setup secret configured.',
          }),
        )
      }
    })
  }

  const ready = setupSecret !== '' && password !== '' && confirmation !== ''
  return (
    <form className="view gate" aria-label="Claim this installation" onSubmit={submit}>
      <header className="gate-head">
        <h1 className="page-title">Set up simple</h1>
        <p className="gate-tagline">Subscribe. Read. Save.</p>
        <p className="note">This installation has no user yet. Claim it with the setup secret it was deployed with.</p>
      </header>
      <Field
        label="Setup secret"
        type="password"
        value={setupSecret}
        autoComplete="off"
        autoFocus
        onChange={setSetupSecret}
      />
      <Field label="Password" type="password" value={password} autoComplete="new-password" onChange={setPassword} />
      <Field
        label="Confirm password"
        type="password"
        value={confirmation}
        autoComplete="new-password"
        onChange={setConfirmation}
      />
      <Button
        className="button button-primary gate-submit"
        type="submit"
        focusableWhenDisabled
        disabled={claiming || !ready}
      >
        {claiming ? 'Claiming…' : 'Claim installation'}
      </Button>
      <p className="note note-error" role="status">
        {notice}
      </p>
    </form>
  )
}
