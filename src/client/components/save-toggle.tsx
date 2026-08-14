import { Toggle } from '@base-ui/react/toggle'
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
    <Toggle className="save-toggle" pressed={saved} aria-label={`save ${title}`} onPressedChange={() => void toggle()}>
      {saved ? 'saved' : 'save'}
    </Toggle>
  )
}
