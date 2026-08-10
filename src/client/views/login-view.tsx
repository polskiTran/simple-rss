import { useState, type FormEvent } from 'react'
import type { AuthStatus } from '../../shared/api.js'
import { signIn } from '../api.js'
import { Field } from '../components/field.js'
import { describeFailure } from './failure.js'

export interface LoginViewProps {
  onSignedIn(status: AuthStatus): void
}

/**
 * Coming back to the reader. One field, because there is one User and so
 * nobody to name — and no "forgot your password" link, because recovery is a
 * shell command rather than an email this installation could not send.
 */
export function LoginView({ onSignedIn }: LoginViewProps) {
  const [password, setPassword] = useState('')
  const [notice, setNotice] = useState('')
  const [signingIn, setSigningIn] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (signingIn) return

    setSigningIn(true)
    setNotice('')
    try {
      onSignedIn(await signIn(password))
    } catch (error) {
      setNotice(describeFailure(error))
      setPassword('')
    } finally {
      setSigningIn(false)
    }
  }

  return (
    <form className="view measure gate" aria-label="Sign in" onSubmit={submit}>
      <Field
        label="password"
        type="password"
        value={password}
        autoComplete="current-password"
        autoFocus
        onChange={setPassword}
      />
      <p className="gate-actions">
        <button className="text-button" type="submit" disabled={signingIn}>
          sign in
        </button>
      </p>
      <p className="notice" role="status">
        {notice}
      </p>
    </form>
  )
}
