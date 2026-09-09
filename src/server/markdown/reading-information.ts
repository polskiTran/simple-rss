/** Same estimate for either displayed source, based on the Markdown sent to Reader View. */
export function readingInformation(markdown: string) {
  const wordCount = markdown.split(/\s+/).filter((token) => /[\p{L}\p{N}]/u.test(token)).length
  return { wordCount, readingTimeMinutes: Math.max(1, Math.ceil(wordCount / 225)) }
}
