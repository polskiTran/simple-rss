import { Field as BaseField } from '@base-ui/react/field'
import { useState, type Ref } from 'react'
import { Icon } from './icon.js'

interface FieldProps {
  readonly label: string
  readonly value: string
  readonly type?: 'text' | 'password' | 'url'
  readonly autoComplete?: string
  readonly autoFocus?: boolean
  readonly placeholder?: string | undefined
  readonly maxLength?: number
  readonly multiline?: boolean
  readonly readOnly?: boolean
  readonly error?: string | undefined
  readonly ref?: Ref<HTMLInputElement>
  onChange(value: string): void
}

export function Field({
  label,
  value,
  type = 'text',
  autoComplete,
  autoFocus,
  placeholder,
  maxLength,
  multiline,
  readOnly,
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
          readOnly={readOnly}
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
      ) : null}
    </BaseField.Root>
  )
}
