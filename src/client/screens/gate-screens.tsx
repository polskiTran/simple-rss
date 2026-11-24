import { Button } from '@base-ui/react/button'
import { type FormEvent, type Ref, useId, useRef, useState, useTransition } from 'react'
import { type AuthStatus, MIN_SETUP_SECRET_LENGTH } from '../../shared/api.js'
import { ApiError, claimInstallation, signIn } from '../api.js'
import { useScreenTitle } from '../arrival.js'
import type { Gate } from '../authentication.js'
import { afterEdit, describeFailure, type Feedback, noteOf, reasonOn, reasonToHold } from '../password-failure.js'
import { LedgerRow } from './parts.js'

export function GateScreen({ gate }: { readonly gate: Gate }) {
  return (
    <main className="x x-page x-gate">
      <header className="x-ledger">{screenFor(gate)}</header>
    </main>
  )
}

function screenFor(gate: Gate) {
  switch (gate.access.kind) {
    case 'checking':
      return (
        <LedgerRow label="simple">
          <span className="x-grey" role="status">
            Opening simple
          </span>
        </LedgerRow>
      )
    case 'unreachable':
    case 'unavailable':
      return <Unanswered kind={gate.access.kind} onRetry={gate.recheck} />
    case 'unclaimed':
      return <SetUp onClaimed={gate.adopt} onAlreadyClaimed={gate.recheck} />
    case 'locked':
      return <SignIn onSignedIn={gate.adopt} />
    case 'open':
      return null
  }
}

function Unanswered({ kind, onRetry }: { readonly kind: 'unreachable' | 'unavailable'; onRetry(): Promise<void> }) {
  const title = kind === 'unreachable' ? 'Can’t reach simple' : 'simple isn’t available'
  useScreenTitle(title)
  const [retrying, startRetry] = useTransition()
  return (
    <>
      <LedgerRow label="simple">
        <h1>{title}</h1>
      </LedgerRow>
      <LedgerRow label="">
        <p className="x-grey">
          {kind === 'unreachable'
            ? 'Check the connection, then try again. simple also tries again once the connection is back.'
            : 'Its server answered with an error. Try again in a moment; simple also keeps trying.'}
        </p>
      </LedgerRow>
      <LedgerRow label="">
        <Button
          className="x-more"
          focusableWhenDisabled
          disabled={retrying}
          aria-busy={retrying}
          onClick={() => startRetry(onRetry)}
        >
          {retrying ? 'Retrying' : 'Retry'}
        </Button>
      </LedgerRow>
    </>
  )
}

function SignIn({ onSignedIn }: { onSignedIn(status: AuthStatus): void }) {
  useScreenTitle('Sign in')
  const [password, setPassword] = useState('')
  const [feedback, setFeedback] = useState<Feedback<'password'>>()
  const [signingIn, startSigningIn] = useTransition()
  const input = useRef<HTMLInputElement>(null)

  const refuse = (reason: string) => {
    setFeedback({ field: 'password', reason })
    input.current?.focus()
  }

  const submit = (event: FormEvent) => {
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
    <form aria-label="Sign in" noValidate onSubmit={submit}>
      <LedgerRow label="simple">
        <h1>Sign in</h1>
      </LedgerRow>
      <GateField
        ref={input}
        label="Password"
        value={password}
        autoComplete="current-password"
        focused
        reason={reasonOn(feedback, 'password')}
        onChange={(value) => {
          setPassword(value)
          setFeedback(afterEdit)
        }}
      />
      <Submit busy={signingIn} note={noteOf(feedback)}>
        {signingIn ? 'Signing in' : 'Sign in'}
      </Submit>
    </form>
  )
}

type SetupField = 'secret' | 'password' | 'confirmation'

function SetUp({ onClaimed, onAlreadyClaimed }: { onClaimed(status: AuthStatus): void; onAlreadyClaimed(): void }) {
  useScreenTitle('Set up')
  const [values, setValues] = useState<Record<SetupField, string>>({ secret: '', password: '', confirmation: '' })
  const [feedback, setFeedback] = useState<Feedback<SetupField>>()
  const [claiming, startClaiming] = useTransition()
  const inputs = {
    secret: useRef<HTMLInputElement>(null),
    password: useRef<HTMLInputElement>(null),
    confirmation: useRef<HTMLInputElement>(null),
  }

  const refuse = (field: SetupField, reason: string) => {
    setFeedback({ field, reason })
    inputs[field].current?.focus()
  }

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (claiming) return
    if (values.secret === '') {
      refuse('secret', 'Enter the setup secret this installation was deployed with.')
      return
    }
    const hold = reasonToHold(values.password, values.confirmation)
    if (hold) {
      refuse(hold.field, hold.reason)
      return
    }
    setFeedback(undefined)
    startClaiming(async () => {
      try {
        onClaimed(await claimInstallation(values.secret, values.password))
      } catch (failure) {
        if (!(failure instanceof ApiError)) setFeedback({ note: describeFailure(failure) })
        else if (failure.code === 'already_claimed') onAlreadyClaimed()
        else if (failure.code === 'invalid_credentials') refuse('secret', 'That setup secret isn’t right.')
        else if (failure.code === 'setup_unavailable')
          setFeedback({
            note: `Setup needs SETUP_SECRET set to at least ${MIN_SETUP_SECRET_LENGTH} characters. Set it, then restart simple.`,
          })
        else setFeedback({ note: describeFailure(failure) })
      }
    })
  }

  const field = (name: SetupField, label: string, autoComplete: string) => (
    <GateField
      ref={inputs[name]}
      label={label}
      value={values[name]}
      autoComplete={autoComplete}
      focused={name === 'secret'}
      reason={reasonOn(feedback, name)}
      onChange={(value) => {
        setValues((current) => ({ ...current, [name]: value }))
        setFeedback(afterEdit)
      }}
    />
  )

  return (
    <form aria-label="Claim this installation" noValidate onSubmit={submit}>
      <LedgerRow label="simple">
        <h1>Set up simple</h1>
      </LedgerRow>
      <LedgerRow label="">
        <p className="x-grey">
          This installation has no user yet. Claim it with the setup secret it was deployed with.
        </p>
      </LedgerRow>
      {field('secret', 'Setup secret', 'off')}
      {field('password', 'Password', 'new-password')}
      {field('confirmation', 'Confirm password', 'new-password')}
      <Submit busy={claiming} note={noteOf(feedback)}>
        {claiming ? 'Claiming' : 'Claim installation'}
      </Submit>
    </form>
  )
}

function GateField({
  label,
  value,
  autoComplete,
  focused,
  reason,
  ref,
  onChange,
}: {
  readonly label: string
  readonly value: string
  readonly autoComplete: string
  readonly focused: boolean
  readonly reason: string | undefined
  readonly ref: Ref<HTMLInputElement>
  onChange(value: string): void
}) {
  const id = useId()
  const [revealed, setRevealed] = useState(false)
  return (
    <LedgerRow label={<label htmlFor={id}>{label}</label>}>
      <span className="x-gate-control">
        <input
          ref={ref}
          id={id}
          className="x-field"
          type={revealed ? 'text' : 'password'}
          value={value}
          autoComplete={autoComplete}
          spellCheck={false}
          // biome-ignore lint/a11y/noAutofocus: the first field of a sign-in or setup form is the only thing to do on the screen.
          autoFocus={focused}
          aria-invalid={reason ? true : undefined}
          aria-describedby={reason ? `${id}-reason` : undefined}
          onChange={(event) => onChange(event.target.value)}
        />
        <Button className="x-more x-grey" onClick={() => setRevealed((shown) => !shown)}>
          {revealed ? 'Hide' : 'Show'}
          <span className="visually-hidden"> {label.toLowerCase()}</span>
        </Button>
      </span>
      {reason ? (
        <p className="x-gate-reason" id={`${id}-reason`}>
          {reason}
        </p>
      ) : null}
    </LedgerRow>
  )
}

function Submit({
  busy,
  note,
  children,
}: {
  readonly busy: boolean
  readonly note: string
  readonly children: string
}) {
  return (
    <LedgerRow label="">
      <Button className="x-more" type="submit" focusableWhenDisabled disabled={busy} aria-busy={busy}>
        {children}
      </Button>
      <p role="status">{note}</p>
    </LedgerRow>
  )
}
