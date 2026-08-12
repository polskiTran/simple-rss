import { useId } from 'react'

export interface FieldProps {
  readonly label: string
  readonly value: string
  readonly type?: 'text' | 'password'
  readonly autoComplete?: string
  readonly autoFocus?: boolean
  onChange(value: string): void
}

// Underlined like the search field — the only rule `docs/DESIGN.md` allows.
// The label is a real `<label>`, not placeholder text, so the field keeps its
// name for screen readers and once filled in.
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
