import { createContext } from 'react'
import { Icon } from './icon.js'

/**
 * Reports a failed save to the line the App keeps, or clears it with undefined.
 * The App holds it because a save can fail after its toggle has left the screen.
 */
export const ReportSaveFailure = createContext<(failure: string | undefined) => void>(() => {})

/** Sticks to the top of the window, so a toggle far down a list still has its answer in view. */
export function SaveFailureLine({ failure, onDismiss }: { readonly failure: string; onDismiss(): void }) {
  return (
    <div className="save-failure">
      <p className="note note-error" role="status">
        {failure}
      </p>
      <button type="button" className="search-clear" aria-label="Dismiss" onClick={onDismiss}>
        <Icon name="x" />
      </button>
    </div>
  )
}
