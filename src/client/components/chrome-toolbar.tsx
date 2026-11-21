import { createContext, use, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

export const ChromeToolbarSlot = createContext<HTMLElement | null>(null)

export function ChromeToolbar({ children }: { readonly children: ReactNode }) {
  const slot = use(ChromeToolbarSlot)
  return slot ? createPortal(children, slot) : null
}
