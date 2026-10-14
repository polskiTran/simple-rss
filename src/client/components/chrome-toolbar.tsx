import { createContext, use, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

/** The chrome's toolbar element, provided by the App once its header has mounted. */
export const ChromeToolbarSlot = createContext<HTMLElement | null>(null)

/**
 * A screen's toolbar, drawn inside the chrome so the stylesheet alone places
 * it: a row under the header on desktop, and on a phone within the top bar,
 * after the search square. Either way it is drawn after the header, as it
 * stands in the DOM, so focus follows what is seen.
 */
export function ChromeToolbar({ children }: { readonly children: ReactNode }) {
  const slot = use(ChromeToolbarSlot)
  return slot ? createPortal(children, slot) : null
}
