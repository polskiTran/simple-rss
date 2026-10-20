import { Icon } from './icon.js'

interface NativeSelectProps<Value extends string> {
  readonly label: string
  readonly value: NoInfer<Value>
  readonly options: readonly { readonly value: Value; readonly label: string }[]
  readonly busy?: boolean
  onChange(value: NoInfer<Value>): void
}

/**
 * A grey button that opens the platform's own picker — on a phone, the native
 * wheel beats any listbox (ADR 0008). Busy while its caller saves, it keeps
 * keyboard focus, as Button's `focusableWhenDisabled` does: it reads as disabled
 * and ignores changes rather than taking the native `disabled`, which drops focus
 * to the body.
 */
export function NativeSelect<const Value extends string>({
  label,
  value,
  options,
  busy = false,
  onChange,
}: NativeSelectProps<Value>) {
  return (
    <span className="select">
      <select
        className="select-control"
        aria-label={label}
        value={value}
        aria-disabled={busy}
        aria-busy={busy}
        onChange={(event) => {
          if (busy) return
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
