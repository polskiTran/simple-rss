export interface HomePageLinkProps {
  readonly className?: string
  readonly domain: string
  /** Null when the Feed has not been retrieved yet, or declares no site of its own. */
  readonly homePageUrl: string | null
}

/** The Feed Home Page's host, as the way out to the publisher; plain text when there is none. */
export function HomePageLink({ className, domain, homePageUrl }: HomePageLinkProps) {
  if (!homePageUrl) return <span className={className}>{domain}</span>
  return (
    <a
      className={className ? `link home-page-link ${className}` : 'link home-page-link'}
      href={homePageUrl}
      target="_blank"
      rel="noopener noreferrer"
    >
      {domain}
    </a>
  )
}
