export interface HomePageLinkProps {
  readonly className?: string
  readonly domain: string
  /** Null when the Feed has not been retrieved yet, or declares no site of its own. */
  readonly homePageUrl: string | null
}

export function HomePageLink({ className, domain, homePageUrl }: HomePageLinkProps) {
  if (!homePageUrl) return <span className={className}>{domain}</span>
  return (
    <a
      className={className ? `home-page-link ${className}` : 'home-page-link'}
      href={homePageUrl}
      target="_blank"
      rel="noopener noreferrer"
    >
      {domain}
    </a>
  )
}
