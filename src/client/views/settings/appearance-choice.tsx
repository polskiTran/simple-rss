import { useState } from 'react'
import { APPEARANCE_OPTIONS, chooseAppearance, storedAppearance, type Appearance } from '../../appearance.js'

/** This device's own choice: never sent to the installation, and system is the absence of one. */
export function AppearanceChoice() {
  const [appearance, setAppearance] = useState<Appearance>(storedAppearance)

  function choose(option: Appearance) {
    chooseAppearance(option)
    setAppearance(option)
  }

  return (
    <span className="appearance-options">
      {APPEARANCE_OPTIONS.map((option) => (
        <button
          key={option}
          className="appearance-option"
          type="button"
          aria-pressed={appearance === option}
          onClick={() => choose(option)}
        >
          {option}
        </button>
      ))}
    </span>
  )
}
