import { createContext } from 'react'
import { Icon } from './icon.js'

export const ReportSaveFailure = createContext<(failure: string | undefined) => void>(() => {})

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
