import { Icon } from './icon.js'

interface HomePageLinkProps {
  readonly domain: string
  /** Null when the Feed has not been retrieved yet, or declares no site of its own. */
  readonly homePageUrl: string | null
}

/**
 * The Feed Home Page's host, as the way out to the publisher: coloured, marked ↗,
 * and opening a new tab. Plain meta text when there is no site.
 */
export function HomePageLink({ domain, homePageUrl }: HomePageLinkProps) {
  if (!homePageUrl) return <span className="feed-host">{domain}</span>
  return (
    <a className="link feed-host" href={homePageUrl} target="_blank" rel="noopener noreferrer">
      {domain}
      <Icon name="external" />
      <span className="visually-hidden"> (opens in a new tab)</span>
    </a>
  )
}
