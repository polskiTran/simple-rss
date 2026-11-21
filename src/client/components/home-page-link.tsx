import { Icon } from './icon.js'

interface HomePageLinkProps {
  readonly domain: string
  readonly homePageUrl: string | null
}

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
