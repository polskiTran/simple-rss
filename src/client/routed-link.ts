import type { MouseEvent } from 'react'

/**
 * The shared onClick for real links the shell routes itself. Anything that is
 * not a plain left click — a modified click, a middle click, a default some
 * other handler already claimed — stays with the browser, so open-in-new-tab
 * and copy-the-address keep working.
 */
export function routedClick(navigate: () => void) {
  return (event: MouseEvent<HTMLAnchorElement>): void => {
    if (
      event.defaultPrevented ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey ||
      event.button !== 0
    ) {
      return
    }
    event.preventDefault()
    navigate()
  }
}
