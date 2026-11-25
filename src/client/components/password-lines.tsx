import { Button } from '@base-ui/react/button'
import { type Ref, useId, useState } from 'react'
import { LedgerRow } from './ledger.js'

export function PasswordLine({
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
          // biome-ignore lint/a11y/noAutofocus: the first line of a sign-in, setup or password-change form is the next thing to do once it shows.
          autoFocus={focused}
          aria-invalid={reason ? true : undefined}
          aria-describedby={reason ? `${id}-reason` : undefined}
          onChange={(event) => onChange(event.target.value)}
        />
        <Button className="x-action x-grey" onClick={() => setRevealed((shown) => !shown)}>
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

export function SubmitLine({
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
      <Button className="x-action" type="submit" focusableWhenDisabled disabled={busy} aria-busy={busy}>
        {children}
      </Button>
      <p role="status">{note}</p>
    </LedgerRow>
  )
}
