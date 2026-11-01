import { Toggle } from '@base-ui/react/toggle'
import { use, useOptimistic, useTransition } from 'react'
import { saveToLibrary, unsaveFromLibrary } from '../api.js'
import { Icon } from './icon.js'
import { ReportSaveFailure } from './save-failure.js'

const LOOKS = {
  square: 'save-toggle',
  labelled: 'button save-toggle save-toggle-labelled',
  word: 'save-word',
} as const

interface SaveToggleProps {
  readonly feedItemId: number
  readonly title: string
  readonly saved: boolean
  /** A list's square; the Reader's toolbar spells the state out beside the icon; the Digest has only the word. */
  readonly look?: keyof typeof LOOKS
  onSaved(saved: boolean): void
}

/**
 * Library membership, pressed while saved. A press shows at once; a failed toggle goes
 * back to the state as it was and says so through the App's line, since rows and
 * toolbars have no room for a sentence.
 * The name starts with the word on screen, Save or Saved, and the icon-only square
 * keeps a steady Save, leaving the state to `aria-pressed`.
 */
export function SaveToggle({ feedItemId, title, saved, look = 'square', onSaved }: SaveToggleProps) {
  const [pending, startToggle] = useTransition()
  const [shown, show] = useOptimistic(saved)
  const report = use(ReportSaveFailure)

  function toggle() {
    if (pending) return
    report(undefined)
    startToggle(async () => {
      show(!saved)
      try {
        const membership = saved ? await unsaveFromLibrary(feedItemId) : await saveToLibrary(feedItemId)
        onSaved(membership.saved)
      } catch {
        report(saved ? `“${title}” is still saved. Try once more.` : `“${title}” couldn’t be saved. Try once more.`)
      }
    })
  }

  const word = shown ? 'Saved' : 'Save'
  return (
    <Toggle
      className={LOOKS[look]}
      pressed={shown}
      aria-label={`${look !== 'square' && shown ? 'Saved' : 'Save'} ${title}`}
      onPressedChange={toggle}
    >
      {look === 'word' ? null : <Icon name="bookmark" filled={shown} />}
      {look === 'word' ? word : null}
      {look === 'labelled' ? <span className="wide-only">{word}</span> : null}
    </Toggle>
  )
}

export function withSaved<Item extends { readonly feedItemId: number; readonly saved: boolean }>(
  items: readonly Item[],
  feedItemId: number,
  saved: boolean,
): Item[] {
  return items.map((item) => (item.feedItemId === feedItemId ? { ...item, saved } : item))
}
