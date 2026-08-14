/** Origin and path only: a Feed URL's query string can carry a subscriber token. */
export function loggableUrl(value: string): string {
  try {
    const url = new URL(value)
    return `${url.origin}${url.pathname}`
  } catch {
    return ''
  }
}
