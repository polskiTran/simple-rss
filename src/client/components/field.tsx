import { Field as BaseField } from '@base-ui/react/field'

export interface FieldProps {
  readonly label: string
  readonly value: string
  readonly type?: 'text' | 'password'
  readonly autoComplete?: string
  readonly autoFocus?: boolean
  /** What stands when the value is left blank, e.g. a Feed's reported title. */
  readonly placeholder?: string | undefined
  /** The server's bound for the value; typing stops there, but a paste is cut silently. */
  readonly maxLength?: number
  /** A paragraph-shaped control for paragraph-shaped values, e.g. a description. */
  readonly multiline?: boolean
  onChange(value: string): void
}

/** A labelled line for one value: Base UI ties the label to the control. */
export function Field({
  label,
  value,
  type = 'text',
  autoComplete,
  autoFocus,
  placeholder,
  maxLength,
  multiline,
  onChange,
}: FieldProps) {
  return (
    <BaseField.Root className="field">
      <BaseField.Label className="field-label">{label}</BaseField.Label>
      <BaseField.Control
        className="field-input"
        type={multiline ? undefined : type}
        value={value}
        autoComplete={autoComplete}
        // Only Setup and Login pass it, and each is a whole page whose single
        // purpose is that one field.
        autoFocus={autoFocus}
        placeholder={placeholder}
        maxLength={maxLength}
        render={multiline ? <textarea rows={3} /> : undefined}
        onValueChange={onChange}
      />
    </BaseField.Root>
  )
}
