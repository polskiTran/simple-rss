import { Icon } from './icon.js'

export interface HomePageLinkProps {
  readonly className?: string
  readonly domain: string
  /** Null when the Feed has not been retrieved yet, or declares no site of its own. */
  readonly homePageUrl: string | null
  /** Drawn as a small button marked ↗ rather than an underlined link, where the Feed is a box. */
  readonly button?: boolean
}

/** The Feed Home Page's host, as the way out to the publisher; plain text when there is none. */
export function HomePageLink({ className, domain, homePageUrl, button = false }: HomePageLinkProps) {
  if (!homePageUrl) return <span className={className}>{domain}</span>
  const look = button ? 'button button-small' : 'link'
  return (
    <a
      className={className ? `${look} ${className}` : look}
      href={homePageUrl}
      target="_blank"
      rel="noopener noreferrer"
    >
      {domain}
      {button ? <Icon name="external" /> : null}
    </a>
  )
}
