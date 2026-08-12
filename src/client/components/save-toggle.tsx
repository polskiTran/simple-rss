import { useState } from 'react'
import { saveToLibrary, unsaveFromLibrary } from '../api.js'

export interface SaveToggleProps {
  readonly feedItemId: number
  readonly title: string
  readonly saved: boolean
  onSaved(saved: boolean): void
}

// A word, never an icon; `saved` takes the design's one reserved accent. The
// word flips only once the server answers — Library membership is the
// server's fact, not the button's.
export function SaveToggle({ feedItemId, title, saved, onSaved }: SaveToggleProps) {
  const [pending, setPending] = useState(false)

  async function toggle() {
    if (pending) return
    setPending(true)
    try {
      const membership = saved ? await unsaveFromLibrary(feedItemId) : await saveToLibrary(feedItemId)
      onSaved(membership.saved)
    } catch {
      // On failure the word keeps the last server-confirmed state.
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
