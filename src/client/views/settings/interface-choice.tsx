import { Choice } from '../../components/choice.js'
import { INTERFACE, INTERFACE_LABELS } from '../../interface.js'
import { useStoredChoice } from '../../stored-choice.js'

export function InterfaceChoice() {
  const chosen = useStoredChoice(INTERFACE)
  return (
    <Choice
      label="Interface"
      options={INTERFACE.options.map((option) => ({ value: option, label: INTERFACE_LABELS[option] }))}
      value={chosen}
      onChange={INTERFACE.choose}
    />
  )
}
