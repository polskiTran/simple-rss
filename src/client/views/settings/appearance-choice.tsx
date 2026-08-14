import { Toggle } from '@base-ui/react/toggle'
import { ToggleGroup } from '@base-ui/react/toggle-group'
import { useState } from 'react'
import { APPEARANCE_OPTIONS, chooseAppearance, storedAppearance, type Appearance } from '../../appearance.js'

/** This device's own choice: never sent to the installation, and system is the absence of one. */
export function AppearanceChoice() {
  const [appearance, setAppearance] = useState<Appearance>(storedAppearance)

  // Pressing the pressed word would empty the group; a device always follows one
  // of the three, so that press stays where it is.
  function choose(chosen: readonly Appearance[]) {
    const option = chosen[0]
    if (!option) return
    chooseAppearance(option)
    setAppearance(option)
  }

  return (
    <ToggleGroup className="appearance-options" value={[appearance]} onValueChange={choose}>
      {APPEARANCE_OPTIONS.map((option) => (
        <Toggle key={option} className="appearance-option" value={option}>
          {option}
        </Toggle>
      ))}
    </ToggleGroup>
  )
}
