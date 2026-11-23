import { Toggle } from '@base-ui/react/toggle'
import { use, useOptimistic, useTransition } from 'react'
import { saveToLibrary, unsaveFromLibrary } from '../api.js'
import { Icon } from './icon.js'
import { ReportSaveFailure } from './save-failure.js'

interface SaveToggleProps {
  readonly feedItemId: number
  readonly title: string
  readonly saved: boolean
  readonly labelled?: boolean
  readonly className?: string
  onSaved(saved: boolean): void
}

export function SaveToggle({ feedItemId, title, saved, labelled = false, className, onSaved }: SaveToggleProps) {
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
      className={className ?? (labelled ? 'button save-toggle-labelled' : 'save-word')}
      pressed={shown}
      aria-label={`${word} ${title}`}
      onPressedChange={toggle}
    >
      {labelled ? (
        <>
          <Icon name="bookmark" filled={shown} />
          <span className="wide-only">{word}</span>
        </>
      ) : (
        word
      )}
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
