import { Button } from '@base-ui/react/button'
import { useState, useTransition, type FormEvent } from 'react'
import { useScreenTitle } from '../arrival.js'
import type { AuthStatus } from '../../shared/api.js'
import { signIn } from '../api.js'
import { Field } from '../components/field.js'
import { describeFailure } from './password-failure.js'

interface LoginViewProps {
  onSignedIn(status: AuthStatus): void
}

export function LoginView({ onSignedIn }: LoginViewProps) {
  useScreenTitle('Sign in')
  const [password, setPassword] = useState('')
  const [notice, setNotice] = useState('')
  const [signingIn, startSigningIn] = useTransition()

  function submit(event: FormEvent) {
    event.preventDefault()
    if (signingIn || password === '') return

    setNotice('')
    startSigningIn(async () => {
      try {
        onSignedIn(await signIn(password))
      } catch (error) {
        setNotice(describeFailure(error))
        setPassword('')
      }
    })
  }

  return (
    <form className="view gate" aria-label="Sign in" onSubmit={submit}>
      <header className="gate-head">
        <h1 className="page-title">Sign in</h1>
        <p className="gate-tagline">Subscribe. Read. Save.</p>
      </header>
      <Field
        label="Password"
        type="password"
        value={password}
        autoComplete="current-password"
        autoFocus
        onChange={setPassword}
      />
      <Button
        className="button button-primary gate-submit"
        type="submit"
        focusableWhenDisabled
        disabled={signingIn || password === ''}
      >
        {signingIn ? 'Signing in…' : 'Sign in'}
      </Button>
      <p className="note note-error" role="status">
        {notice}
      </p>
    </form>
  )
}
