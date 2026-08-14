import { useState } from 'react'
import { saveToLibrary, unsaveFromLibrary } from '../api.js'

export interface SaveToggleProps {
  readonly feedItemId: number
  readonly title: string
  readonly saved: boolean
  onSaved(saved: boolean): void
}

export function SaveToggle({ feedItemId, title, saved, onSaved }: SaveToggleProps) {
  const [pending, setPending] = useState(false)

  async function toggle() {
    if (pending) return
    setPending(true)
    try {
      const membership = saved ? await unsaveFromLibrary(feedItemId) : await saveToLibrary(feedItemId)
      onSaved(membership.saved)
    } catch {
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
