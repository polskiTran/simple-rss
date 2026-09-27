import { useState } from 'react'
import { APPEARANCE_OPTIONS, chooseAppearance, storedAppearance, type Appearance } from '../../appearance.js'
import { Choice } from '../../components/choice.js'

const LABELS = { system: 'System', light: 'Light', dark: 'Dark' } as const satisfies Record<Appearance, string>

export function AppearanceChoice() {
  const [appearance, setAppearance] = useState<Appearance>(storedAppearance)

  return (
    <Choice
      label="Appearance"
      options={APPEARANCE_OPTIONS.map((option) => ({ value: option, label: LABELS[option] }))}
      value={appearance}
      onChange={(option) => {
        chooseAppearance(option)
        setAppearance(option)
      }}
    />
  )
}
