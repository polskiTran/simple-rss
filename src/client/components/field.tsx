import { Field as BaseField } from '@base-ui/react/field'
import { useState, type Ref } from 'react'
import { Icon } from './icon.js'

interface FieldProps {
  readonly label: string
  readonly value: string
  /** `url` keeps a text input — a bare host is a fine answer — with the URL keyboard. */
  readonly type?: 'text' | 'password' | 'url'
  readonly autoComplete?: string
  readonly autoFocus?: boolean
  readonly placeholder?: string | undefined
  readonly maxLength?: number
  readonly multiline?: boolean
  readonly note?: string | undefined
  readonly error?: string | undefined
  /** The input, for a form that moves focus to the field in error. */
  readonly ref?: Ref<HTMLInputElement>
  onChange(value: string): void
}

/**
 * A labelled control for one value. Base UI ties the label, and the note or
 * error under it, to the control. A password field carries its own reveal.
 */
export function Field({
  label,
  value,
  type = 'text',
  autoComplete,
  autoFocus,
  placeholder,
  maxLength,
  multiline,
  note,
  error,
  ref,
  onChange,
}: FieldProps) {
  const [revealed, setRevealed] = useState(false)
  const password = type === 'password'

  return (
    <BaseField.Root className="field" invalid={error !== undefined}>
      <BaseField.Label className="field-label">{label}</BaseField.Label>
      <span className="field-control">
        <BaseField.Control
          ref={ref}
          className="field-input"
          type={multiline ? undefined : password && !revealed ? 'password' : 'text'}
          inputMode={type === 'url' ? 'url' : undefined}
          value={value}
          autoComplete={autoComplete}
          autoFocus={autoFocus}
          spellCheck={type === 'text' ? undefined : false}
          placeholder={placeholder}
          maxLength={maxLength}
          render={multiline ? <textarea rows={3} /> : undefined}
          onValueChange={onChange}
        />
        {password ? (
          <button
            type="button"
            className="field-reveal"
            aria-label={revealed ? 'Hide password' : 'Show password'}
            aria-pressed={revealed}
            onClick={() => setRevealed(!revealed)}
          >
            <Icon name={revealed ? 'eye-off' : 'eye'} />
          </button>
        ) : null}
      </span>
      {error !== undefined ? (
        <BaseField.Description className="field-note field-error">{error}</BaseField.Description>
      ) : note !== undefined ? (
        <BaseField.Description className="field-note">{note}</BaseField.Description>
      ) : null}
    </BaseField.Root>
  )
}
