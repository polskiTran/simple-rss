import { useId } from 'react'

export interface FieldProps {
  readonly label: string
  readonly value: string
  readonly type?: 'text' | 'password'
  readonly autoComplete?: string
  readonly autoFocus?: boolean
  onChange(value: string): void
}

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
        // biome-ignore lint/a11y/noAutofocus: only Setup and Login pass it, and each is a whole page whose single purpose is that one field.
        autoFocus={autoFocus}
        onChange={(event) => onChange(event.target.value)}
      />
    </p>
  )
}
