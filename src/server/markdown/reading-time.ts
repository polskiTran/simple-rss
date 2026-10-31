export function readingTimeMinutes(markdown: string): number {
  const words = markdown.split(/\s+/).filter((token) => /[\p{L}\p{N}]/u.test(token)).length
  return Math.max(1, Math.ceil(words / 225))
}
