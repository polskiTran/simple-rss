import type { MouseEvent } from 'react'

/**
 * Shared onClick for links the shell routes itself. Anything but a plain left
 * click — modified, middle, or already-handled — stays with the browser.
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
