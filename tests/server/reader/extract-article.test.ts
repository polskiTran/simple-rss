import { describe, expect, it } from 'vitest'
import { extractArticle } from '../../../src/server/reader/extract-article.js'

const URL = 'https://publisher.example/writing/prompt-injection'

function page(article: string, head = ''): Uint8Array {
  return new TextEncoder().encode(
    `<!doctype html>
     <html lang="en">
       <head><meta charset="utf-8"><title>Prompt injection, three years in</title>${head}</head>
       <body>
         <nav><a href="/">Home</a><a href="/archive">Archive</a><a href="/about">About</a></nav>
         <main><article>${article}</article></main>
         <footer id="footer" class="site-footer"><p>Subscribe to the newsletter for more.</p></footer>
       </body>
     </html>`,
  )
}

const LONG_FORM = `
  <h1>Prompt injection, three years in</h1>
  ${Array.from({ length: 40 }, (_, index) => `<p>Paragraph ${index} keeps the argument moving with a steady sentence about trusted instructions and untrusted text, long enough to count as reading.</p>`).join('\n')}
  <h2>What holds up</h2>
  <pre><code class="language-python">def guard(tool_call):\n    return review(tool_call)</code></pre>
  <table><tr><th>Mitigation</th><th>Holds</th></tr><tr><td>asking nicely</td><td>no</td></tr></table>
`

describe('extractArticle', () => {
  it('extracts long-form technical content as structured markdown', async () => {
    const { article } = await extractArticle({ bytes: page(LONG_FORM), url: URL })

    expect(article).toBeDefined()
    expect(article?.markdown).toContain('Paragraph 7 keeps the argument moving')
    expect(article?.markdown).toContain('## What holds up')
    expect(article?.markdown).toContain('```python')
    expect(article?.markdown).toMatch(/\|\s*Mitigation\s*\|\s*Holds\s*\|/)
    expect(article?.markdown).not.toContain('Archive')
    expect(article?.markdown).not.toContain('newsletter')
  })

  it('estimates reading time from what the Reader will actually show', async () => {
    const { article } = await extractArticle({ bytes: page(LONG_FORM), url: URL })

    expect(article?.wordCount).toBeGreaterThan(700)
    expect(article?.readingTimeMinutes).toBe(Math.ceil((article?.wordCount ?? 0) / 225))
  })

  it('times each extraction phase it reached, without recording content', async () => {
    const { timings } = await extractArticle({ bytes: page(LONG_FORM), url: URL })

    expect(timings.domMs).toBeGreaterThanOrEqual(0)
    expect(timings.defuddleMs).toBeGreaterThanOrEqual(0)
    expect(timings.markdownPolicyMs).toBeGreaterThanOrEqual(0)
  })

  it('honours a declared transport charset over the UTF-8 default', async () => {
    const body =
      '<html><head><title>t</title></head><body><p>café terrace, and a paragraph long enough for the extractor to keep it as real article content.</p></body></html>'
    const latin1 = Uint8Array.from([...body].map((char) => char.charCodeAt(0)))
    const { article } = await extractArticle({ bytes: latin1, charset: 'windows-1252', url: URL })

    expect(article?.markdown).toContain('café terrace')
  })

  it('reads the charset a page only declares in its meta tag', async () => {
    const body =
      '<html><head><meta charset="windows-1252"></head><body><p>café terrace, and a paragraph long enough for the extractor to keep it as real article content.</p></body></html>'
    const bytes = Uint8Array.from([...body].map((char) => char.charCodeAt(0)))
    const { article } = await extractArticle({ bytes, url: URL })

    expect(article?.markdown).toContain('café terrace')
  })

  it('answers no article when a page has nothing to extract, still carrying its timings', async () => {
    const outcome = await extractArticle({
      bytes: new TextEncoder().encode('<!doctype html><html><head></head><body></body></html>'),
      url: URL,
    })

    expect(outcome.article).toBeUndefined()
    expect(outcome.timings.domMs).toBeGreaterThanOrEqual(0)
    expect(outcome.timings.defuddleMs).toBeGreaterThanOrEqual(0)
  })
})
