import { Button } from '@base-ui/react/button'
import { useRef, useState, useTransition, type FormEvent } from 'react'
import { useScreenTitle } from '../arrival.js'
import { MIN_SETUP_SECRET_LENGTH, type AuthStatus } from '../../shared/api.js'
import { ApiError, claimInstallation } from '../api.js'
import { Field } from '../components/field.js'
import { describeFailure, reasonToHold } from './password-failure.js'

interface SetupViewProps {
  onClaimed(status: AuthStatus): void
  onAlreadyClaimed(): void
}

type SetupField = 'secret' | 'password' | 'confirmation'

/**
 * Claim installation is never disabled before it is pressed: a reason that
 * belongs to one field — an empty or wrong secret, a short or mismatched
 * password — goes on that field, which takes focus. A deployment whose setup
 * secret is missing or too short is the operator's to fix, in the form's note.
 */
export function SetupView({ onClaimed, onAlreadyClaimed }: SetupViewProps) {
  useScreenTitle('Set up')
  const [setupSecret, setSetupSecret] = useState('')
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [error, setError] = useState<{ readonly field: SetupField; readonly reason: string }>()
  const [notice, setNotice] = useState('')
  const [claiming, startClaiming] = useTransition()
  const inputs = {
    secret: useRef<HTMLInputElement>(null),
    password: useRef<HTMLInputElement>(null),
    confirmation: useRef<HTMLInputElement>(null),
  }

  function refuse(field: SetupField, reason: string) {
    setError({ field, reason })
    inputs[field].current?.focus()
  }

  function edited(update: (value: string) => void) {
    return (value: string) => {
      update(value)
      setError(undefined)
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault()
    if (claiming) return
    if (setupSecret === '') {
      refuse('secret', 'Enter the setup secret this installation was deployed with.')
      return
    }
    const hold = reasonToHold(password, confirmation)
    if (hold) {
      refuse(hold.field, hold.reason)
      return
    }

    setError(undefined)
    setNotice('')
    startClaiming(async () => {
      try {
        onClaimed(await claimInstallation(setupSecret, password))
      } catch (failure) {
        if (!(failure instanceof ApiError)) setNotice(describeFailure(failure))
        else if (failure.code === 'already_claimed') onAlreadyClaimed()
        else if (failure.code === 'invalid_credentials') refuse('secret', 'That setup secret isn’t right.')
        else if (failure.code === 'setup_unavailable')
          setNotice(
            `Setup needs SETUP_SECRET set to at least ${MIN_SETUP_SECRET_LENGTH} characters. Set it, then restart simple.`,
          )
        else setNotice(describeFailure(failure))
      }
    })
  }

  const errorOn = (field: SetupField) => (error?.field === field ? error.reason : undefined)
  return (
    <form className="view gate" aria-label="Claim this installation" onSubmit={submit}>
      <header className="gate-head">
        <h1 className="page-title">Set up simple</h1>
        <p className="gate-tagline">Subscribe. Read. Save.</p>
        <p className="note">This installation has no user yet. Claim it with the setup secret it was deployed with.</p>
      </header>
      <Field
        ref={inputs.secret}
        label="Setup secret"
        type="password"
        value={setupSecret}
        autoComplete="off"
        autoFocus
        error={errorOn('secret')}
        onChange={edited(setSetupSecret)}
      />
      <Field
        ref={inputs.password}
        label="Password"
        type="password"
        value={password}
        autoComplete="new-password"
        error={errorOn('password')}
        onChange={edited(setPassword)}
      />
      <Field
        ref={inputs.confirmation}
        label="Confirm password"
        type="password"
        value={confirmation}
        autoComplete="new-password"
        error={errorOn('confirmation')}
        onChange={edited(setConfirmation)}
      />
      <Button
        className="button button-primary gate-submit"
        type="submit"
        focusableWhenDisabled
        disabled={claiming}
        aria-busy={claiming}
      >
        {claiming ? 'Claiming…' : 'Claim installation'}
      </Button>
      <p className="note note-error" role="status">
        {notice}
      </p>
    </form>
  )
}
