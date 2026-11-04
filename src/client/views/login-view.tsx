import { Button } from '@base-ui/react/button'
import { useRef, useState, useTransition, type FormEvent } from 'react'
import { useScreenTitle } from '../arrival.js'
import type { AuthStatus } from '../../shared/api.js'
import { ApiError, signIn } from '../api.js'
import { Field } from '../components/field.js'
import { afterEdit, describeFailure, noteOf, reasonOn, type Feedback } from './password-failure.js'

interface LoginViewProps {
  onSignedIn(status: AuthStatus): void
}

/**
 * Sign in is never disabled before it is pressed: pressed empty, or answered
 * with a wrong password, it says why on the field and puts focus back there.
 * Anything else — a lost connection, too many attempts — is the form's note.
 */
export function LoginView({ onSignedIn }: LoginViewProps) {
  useScreenTitle('Sign in')
  const [password, setPassword] = useState('')
  const [feedback, setFeedback] = useState<Feedback<'password'>>()
  const [signingIn, startSigningIn] = useTransition()
  const input = useRef<HTMLInputElement>(null)

  function refuse(reason: string) {
    setFeedback({ field: 'password', reason })
    input.current?.focus()
  }

  function submit(event: FormEvent) {
    event.preventDefault()
    if (signingIn) return
    if (password === '') {
      refuse('Enter your password.')
      return
    }

    setFeedback(undefined)
    startSigningIn(async () => {
      try {
        onSignedIn(await signIn(password))
      } catch (failure) {
        setPassword('')
        if (failure instanceof ApiError && failure.code === 'invalid_credentials') refuse(describeFailure(failure))
        else setFeedback({ note: describeFailure(failure) })
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
        ref={input}
        label="Password"
        type="password"
        value={password}
        autoComplete="current-password"
        autoFocus
        error={reasonOn(feedback, 'password')}
        onChange={(value) => {
          setPassword(value)
          setFeedback(afterEdit)
        }}
      />
      <Button
        className="button button-primary gate-submit"
        type="submit"
        focusableWhenDisabled
        disabled={signingIn}
        aria-busy={signingIn}
      >
        {signingIn ? 'Signing in…' : 'Sign in'}
      </Button>
      <p className="note note-error" role="status">
        {noteOf(feedback)}
      </p>
    </form>
  )
}
