import { useState } from 'react'
import { saveToLibrary, unsaveFromLibrary } from '../api.js'

export interface SaveToggleProps {
  readonly feedItemId: number
  /** The Feed Item's title, naming the control for assistive technology. */
  readonly title: string
  readonly saved: boolean
  /** Told when the server confirms the membership this toggle asked for. */
  onSaved(saved: boolean): void
}

/**
 * The save affordance: a word, never an icon. `save` sits in the quietest
 * grey; `saved` takes the one accent the design reserves. It toggles in place
 * inside the same width, with no animation — and only once the server has
 * answered, because Library membership is the server's fact, not the button's.
 */
export function SaveToggle({ feedItemId, title, saved, onSaved }: SaveToggleProps) {
  const [pending, setPending] = useState(false)

  async function toggle() {
    if (pending) return
    setPending(true)
    try {
      const membership = saved ? await unsaveFromLibrary(feedItemId) : await saveToLibrary(feedItemId)
      onSaved(membership.saved)
    } catch {
      // The word keeps saying the state the server last confirmed.
    } finally {
      setPending(false)
    }
  }

  return (
    <button
      className="save-toggle"
      type="button"
      aria-pressed={saved}
      aria-label={`save ${title}`}
      onClick={() => void toggle()}
    >
      {saved ? 'saved' : 'save'}
    </button>
  )
}
