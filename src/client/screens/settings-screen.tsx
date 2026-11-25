import { Button } from '@base-ui/react/button'
import { type FormEvent, useId, useRef, useState, useTransition } from 'react'
import type { AuthStatus } from '../../shared/api.js'
import { APPEARANCE_OPTIONS, type Appearance, chooseAppearance, storedAppearance } from '../appearance.js'
import { useScreenTitle } from '../arrival.js'
import { ApiError, changePassword, fetchInstallationPreferences, signOut, updateInstallationTimezone } from '../api.js'
import { useResource } from '../use-resource.js'
import { afterEdit, describeFailure, type Feedback, noteOf, reasonOn, reasonToHold } from '../password-failure.js'
import { timezoneFailure, timezoneOptions } from '../timezone.js'
import { VersionNote } from '../components/version-note.js'
import { LedgerRow, LoadFailure, Options } from '../components/ledger.js'
import { PasswordLine, SubmitLine } from '../components/password-lines.js'

const APPEARANCE_LABELS = { system: 'System', light: 'Light', dark: 'Dark' } as const satisfies Record<
  Appearance,
  string
>

export function SettingsScreen({ onAccessChanged }: { onAccessChanged(status: AuthStatus): void }) {
  useScreenTitle('Settings')
  const [appearance, setAppearance] = useState(storedAppearance)
  const [changing, setChanging] = useState(false)
  const [leaving, startLeaving] = useTransition()
  const [leaveFailure, setLeaveFailure] = useState('')

  const leave = () => {
    if (leaving) return
    setLeaveFailure('')
    startLeaving(async () => {
      try {
        await signOut()
        onAccessChanged({ claimed: true, authenticated: false })
      } catch {
        setLeaveFailure('Couldn’t sign out. Try again in a moment.')
      }
    })
  }

  return (
    <div>
      <header className="x-ledger">
        <h1 className="visually-hidden">Settings</h1>
        <LedgerRow label="Theme">
          <Options
            label="Theme"
            options={APPEARANCE_OPTIONS.map((option) => ({ value: option, label: APPEARANCE_LABELS[option] }))}
            value={appearance}
            onChange={(option) => {
              chooseAppearance(option)
              setAppearance(option)
            }}
          />
        </LedgerRow>
        <Timezone />
        <LedgerRow label="Export">
          <span className="x-actions">
            <a className="x-action" href="/api/subscriptions/export" download="subscriptions.opml">
              Subscriptions as OPML
            </a>
            <a className="x-action" href="/api/export" download="simple-rss-export.json">
              Everything as JSON
            </a>
          </span>
        </LedgerRow>
        <LedgerRow label="Account">
          <span className="x-actions">
            <Button className="x-action" aria-expanded={changing} onClick={() => setChanging((shown) => !shown)}>
              Change password
            </Button>
            <Button className="x-action" focusableWhenDisabled disabled={leaving} aria-busy={leaving} onClick={leave}>
              {leaving ? 'Signing out' : 'Sign out'}
            </Button>
          </span>
          {leaveFailure ? <p role="status">{leaveFailure}</p> : null}
        </LedgerRow>
        {changing ? <PasswordForm onChanged={onAccessChanged} /> : null}
        <LedgerRow label="Version">
          simple <VersionNote />
        </LedgerRow>
      </header>
    </div>
  )
}

function Timezone() {
  const id = useId()
  const [preferences, { set, retry }] = useResource('preferences', fetchInstallationPreferences)
  const [saving, startSaving] = useTransition()
  const [failure, setFailure] = useState('')

  if (preferences.kind !== 'loaded') {
    return (
      <LedgerRow label="Timezone">
        {preferences.kind === 'loading' ? (
          <span className="x-grey">Loading</span>
        ) : (
          <LoadFailure subject="The timezone" kind={preferences.kind} onRetry={retry} />
        )}
      </LedgerRow>
    )
  }

  const held = preferences.value.timezone
  const change = (chosen: string) => {
    if (saving) return
    setFailure('')
    set((current) => ({ ...current, timezone: chosen }))
    startSaving(async () => {
      try {
        const updated = await updateInstallationTimezone(chosen)
        set(() => updated)
      } catch (error) {
        set((current) => ({ ...current, timezone: held }))
        setFailure(timezoneFailure(error))
      }
    })
  }

  return (
    <LedgerRow label={<label htmlFor={id}>Timezone</label>}>
      <select
        id={id}
        className="x-select"
        value={held}
        aria-busy={saving}
        onChange={(event) => change(event.target.value)}
      >
        {timezoneOptions(held).map((zone) => (
          <option key={zone} value={zone}>
            {zone}
          </option>
        ))}
      </select>
      {failure ? <p role="status">{failure}</p> : null}
    </LedgerRow>
  )
}

type PasswordField = 'current' | 'password' | 'confirmation'

function PasswordForm({ onChanged }: { onChanged(status: AuthStatus): void }) {
  const [values, setValues] = useState<Record<PasswordField, string>>({ current: '', password: '', confirmation: '' })
  const [feedback, setFeedback] = useState<Feedback<PasswordField>>()
  const [saving, startSaving] = useTransition()
  const inputs = {
    current: useRef<HTMLInputElement>(null),
    password: useRef<HTMLInputElement>(null),
    confirmation: useRef<HTMLInputElement>(null),
  }

  const refuse = (field: PasswordField, reason: string) => {
    setFeedback({ field, reason })
    inputs[field].current?.focus()
  }

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (saving) return
    if (values.current === '') {
      refuse('current', 'Enter the password you sign in with now.')
      return
    }
    const hold = reasonToHold(values.password, values.confirmation)
    if (hold) {
      refuse(hold.field, hold.reason)
      return
    }
    setFeedback(undefined)
    startSaving(async () => {
      try {
        onChanged(await changePassword(values.current, values.password))
      } catch (failure) {
        if (failure instanceof ApiError && failure.code === 'invalid_credentials')
          refuse('current', describeFailure(failure))
        else setFeedback({ note: describeFailure(failure) })
      }
    })
  }

  const field = (name: PasswordField, label: string, autoComplete: string) => (
    <PasswordLine
      ref={inputs[name]}
      label={label}
      value={values[name]}
      autoComplete={autoComplete}
      focused={name === 'current'}
      reason={reasonOn(feedback, name)}
      onChange={(value) => {
        setValues((current) => ({ ...current, [name]: value }))
        setFeedback(afterEdit)
      }}
    />
  )

  return (
    <form aria-label="Change password" noValidate onSubmit={submit}>
      <LedgerRow label="">
        <p className="x-grey">Changing it signs out every device, including this one.</p>
      </LedgerRow>
      {field('current', 'Current password', 'current-password')}
      {field('password', 'New password', 'new-password')}
      {field('confirmation', 'Confirm new password', 'new-password')}
      <SubmitLine busy={saving} note={noteOf(feedback)}>
        {saving ? 'Changing' : 'Change password'}
      </SubmitLine>
    </form>
  )
}
