import { Field as BaseField } from '@base-ui/react/field'

export interface FieldProps {
  readonly label: string
  readonly value: string
  readonly type?: 'text' | 'password'
  readonly autoComplete?: string
  readonly autoFocus?: boolean
  /** What stands when the value is left blank, e.g. a Feed's reported title. */
  readonly placeholder?: string | undefined
  onChange(value: string): void
}

/** A labelled line for one value: Base UI ties the label to the control. */
export function Field({ label, value, type = 'text', autoComplete, autoFocus, placeholder, onChange }: FieldProps) {
  return (
    <BaseField.Root className="field">
      <BaseField.Label className="field-label">{label}</BaseField.Label>
      <BaseField.Control
        className="field-input"
        type={type}
        value={value}
        autoComplete={autoComplete}
        // Only Setup and Login pass it, and each is a whole page whose single
        // purpose is that one field.
        autoFocus={autoFocus}
        placeholder={placeholder}
        onValueChange={onChange}
      />
    </BaseField.Root>
  )
}
