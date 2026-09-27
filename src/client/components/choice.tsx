import { Toggle } from '@base-ui/react/toggle'
import { ToggleGroup } from '@base-ui/react/toggle-group'

export interface ChoiceOption<Value extends string> {
  readonly value: Value
  readonly label: string
}

export interface ChoiceProps<Value extends string> {
  /** Names the group for assistive technology; the segments name the values. */
  readonly label: string
  readonly options: readonly ChoiceOption<Value>[]
  readonly value: NoInfer<Value>
  readonly className?: string
  onChange(value: NoInfer<Value>): void
}

/**
 * The switch: one value of a few, always exactly one. Arrow keys move between
 * segments under Base UI's roving tabindex.
 */
export function Choice<const Value extends string>({ label, options, value, className, onChange }: ChoiceProps<Value>) {
  return (
    <ToggleGroup
      className={className ? `switch ${className}` : 'switch'}
      aria-label={label}
      value={[value]}
      onValueChange={(chosen) => {
        // Pressing the pressed segment would empty the group; a switch always
        // holds one value, so that press stays where it is.
        const next = options.find((option) => option.value === chosen[0])
        if (next && next.value !== value) onChange(next.value)
      }}
    >
      {options.map((option) => (
        <Toggle key={option.value} className="switch-segment" value={option.value}>
          {option.label}
        </Toggle>
      ))}
    </ToggleGroup>
  )
}
