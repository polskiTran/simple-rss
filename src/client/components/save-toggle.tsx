import { Toggle } from '@base-ui/react/toggle'
import { use, useOptimistic, useTransition } from 'react'
import { saveToLibrary, unsaveFromLibrary } from '../api.js'
import { Icon } from './icon.js'
import { ReportSaveFailure } from './save-failure.js'

interface SaveToggleProps {
  readonly feedItemId: number
  readonly title: string
  readonly saved: boolean
  /** The Reader's toolbar spells the state out beside the icon, where there is room. */
  readonly labelled?: boolean
  onSaved(saved: boolean): void
}

/**
 * Library membership, pressed while saved. A press shows at once; a failed toggle goes
 * back to the state as it was and says so through the App's line, since rows and
 * toolbars have no room for a sentence.
 * The name starts with the word on screen — the labelled toggle's Save or Saved — and
 * the icon-only square keeps a steady Save, leaving the state to `aria-pressed`.
 */
export function SaveToggle({ feedItemId, title, saved, labelled = false, onSaved }: SaveToggleProps) {
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

  return (
    <Toggle
      className={labelled ? 'button save-toggle save-toggle-labelled' : 'save-toggle'}
      pressed={shown}
      aria-label={`${labelled && shown ? 'Saved' : 'Save'} ${title}`}
      onPressedChange={toggle}
    >
      <Icon name="bookmark" filled={shown} />
      {labelled ? <span className="wide-only">{shown ? 'Saved' : 'Save'}</span> : null}
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
