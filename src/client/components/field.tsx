import { useId } from 'react'

export interface FieldProps {
  readonly label: string
  readonly value: string
  readonly type?: 'text' | 'password'
  /** Lets a password manager recognise the field it is looking at. */
  readonly autoComplete?: string
  readonly autoFocus?: boolean
  onChange(value: string): void
}

/**
 * One labelled line with the search field's underline beneath it, which
 * `docs/DESIGN.md` makes the only rule in the system. The label is a real
 * `<label>`, not placeholder text: minimalism is not a reason to leave a field
 * unnamed to a screen reader or to lose its name as soon as it is filled in.
 */
export function Field({ label, value, type = 'text', autoComplete, autoFocus, onChange }: FieldProps) {
  const id = useId()

  return (
    <p className="field">
      <label className="field-label" htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        className="field-input"
        type={type}
        value={value}
        autoComplete={autoComplete}
        autoFocus={autoFocus}
        onChange={(event) => onChange(event.target.value)}
      />
    </p>
  )
}
