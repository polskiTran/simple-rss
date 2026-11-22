import type { ComponentProps } from 'react'

type RoutedLinkProps = Omit<ComponentProps<'a'>, 'href' | 'onClick'> & {
  readonly href: string
  onNavigate(): void
}

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
