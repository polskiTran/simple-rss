import { Toggle } from '@base-ui/react/toggle'
import { useState } from 'react'
import { saveToLibrary, unsaveFromLibrary } from '../api.js'
import { Icon } from './icon.js'

export interface SaveToggleProps {
  readonly feedItemId: number
  readonly title: string
  readonly saved: boolean
  /** The Reader's toolbar spells the state out beside the icon, where there is room. */
  readonly labelled?: boolean
  onSaved(saved: boolean): void
}

/**
 * Library membership, pressed while saved. A failed toggle leaves the state as it was.
 * The name starts with the word on screen — the labelled toggle's Save or Saved — and
 * the icon-only square keeps a steady Save, leaving the state to `aria-pressed`.
 */
export function SaveToggle({ feedItemId, title, saved, labelled = false, onSaved }: SaveToggleProps) {
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
    <Toggle
      className={labelled ? 'button save-toggle save-toggle-labelled' : 'save-toggle'}
      pressed={saved}
      aria-label={`${labelled && saved ? 'Saved' : 'Save'} ${title}`}
      onPressedChange={() => void toggle()}
    >
      <Icon name="bookmark" filled={saved} />
      {labelled ? <span className="wide-only">{saved ? 'Saved' : 'Save'}</span> : null}
    </Toggle>
  )
}

/** The list after a SaveToggle answered: the one Feed Item's `saved` replaced, every other item as it was. */
export function withSaved<Item extends { readonly feedItemId: number; readonly saved: boolean }>(
  items: readonly Item[],
  feedItemId: number,
  saved: boolean,
): Item[] {
  return items.map((item) => (item.feedItemId === feedItemId ? { ...item, saved } : item))
}
