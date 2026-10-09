import type { ComponentProps } from 'react'

type RoutedLinkProps = Omit<ComponentProps<'a'>, 'href' | 'onClick'> & {
  readonly href: string
  onNavigate(): void
}

/**
 * A link the shell routes itself: a plain left click calls `onNavigate`.
 * Anything else — modified, middle, or already handled — stays with the browser.
 */
export function RoutedLink({ href, onNavigate, ...anchor }: RoutedLinkProps) {
  return (
    <a
      {...anchor}
      href={href}
      onClick={(event) => {
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
        onNavigate()
      }}
    />
  )
}
