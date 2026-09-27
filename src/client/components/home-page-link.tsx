import { Icon } from './icon.js'

export interface HomePageLinkProps {
  readonly className?: string
  readonly domain: string
  /** Null when the Feed has not been retrieved yet, or declares no site of its own. */
  readonly homePageUrl: string | null
  /** Marks the link ↗ as leaving the installation, where a Feed is drawn as a box. */
  readonly arrow?: boolean
}

/** The Feed Home Page's host, as the way out to the publisher; plain text when there is none. */
export function HomePageLink({ className, domain, homePageUrl, arrow = false }: HomePageLinkProps) {
  if (!homePageUrl) return <span className={className}>{domain}</span>
  return (
    <a
      className={className ? `link ${className}` : 'link'}
      href={homePageUrl}
      target="_blank"
      rel="noopener noreferrer"
    >
      {domain}
      {arrow ? <Icon name="external" /> : null}
    </a>
  )
}
