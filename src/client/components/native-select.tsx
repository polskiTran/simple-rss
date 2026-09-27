import { Icon } from './icon.js'

export interface NativeSelectProps<Value extends string> {
  readonly label: string
  readonly value: NoInfer<Value>
  readonly options: readonly { readonly value: Value; readonly label: string }[]
  readonly disabled?: boolean
  onChange(value: NoInfer<Value>): void
}

/**
 * A grey button that opens the platform's own picker — on a phone, the native
 * wheel beats any listbox (ADR 0008). Disabling it drops focus, as ever.
 */
export function NativeSelect<const Value extends string>({
  label,
  value,
  options,
  disabled = false,
  onChange,
}: NativeSelectProps<Value>) {
  return (
    <span className="select">
      <select
        className="select-control"
        aria-label={label}
        value={value}
        disabled={disabled}
        onChange={(event) => {
          const chosen = options.find((option) => option.value === event.target.value)
          if (chosen) onChange(chosen.value)
        }}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <Icon name="chevron-down" />
    </span>
  )
}
