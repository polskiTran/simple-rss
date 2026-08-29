import { parseHTML } from 'linkedom'
import { describe, expect, it } from 'vitest'
import {
  extractArticle,
  FULL_CLEANUP_MAX_BYTES,
  FULL_CLEANUP_MAX_ELEMENTS,
} from '../../../src/server/reader/extract-article.js'

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

const HAZARDS = `
  <script>window.__STATE__ = {"secret":"framework state"}</script>
  <script type="application/json" id="__NEXT_DATA__">{"props":{"leak":"next data"}}</script>
  <style>.article { color: red }</style>
  <template><p>template shadow content</p></template>
  <noscript><p>noscript fallback content</p></noscript>
  <iframe src="https://tracker.example/frame"></iframe>
  <p>A <a href="javascript:alert(1)">dangerous link</a> and a <a href="/writing/next">safe link</a>.</p>
  <p><img src="/images/figure.png" alt="a figure"></p>
  <p>raw <b onclick="alert(2)">markup</b> stays textual</p>
`

const HAZARD_LEAKS = [
  'schema.org',
  'framework state',
  'next data',
  'color: red',
  'template shadow',
  'noscript fallback',
  'tracker.example',
  'javascript:',
  'onclick',
] as const

const JSON_LD = `<script type="application/ld+json">{"@context":"https://schema.org","@type":"Article","headline":"Prompt injection","author":{"@type":"Person","name":"Grace Hopper"}}</script>`

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

  it('extracts an ordinary page without leaking JSON-LD, scripts, framework state, or unsigned images', async () => {
    const { article } = await extractArticle({
      bytes: page(`${LONG_FORM}${HAZARDS}`, JSON_LD),
      url: URL,
    })

    expect(article?.markdown).toContain('Paragraph 7 keeps the argument moving')
    for (const leak of HAZARD_LEAKS) expect(article?.markdown).not.toContain(leak)
    expect(article?.markdown).not.toContain('figure.png')
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

const BYLINE = '<p>By Ada Lovelace</p><div>4 min read</div>'
const TRAILING_BOILERPLATE = `<div><h2>Related posts</h2><ul><li><a href="/writing/a">Another piece</a></li><li><a href="/writing/b">One more piece</a></li></ul></div><div>Subscribe to our newsletter and never miss the latest updates.</div>`
const BOILERPLATE_MARKERS = ['Ada Lovelace', 'min read', 'newsletter'] as const

function complexityHtml(body: string, head = ''): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>Complexity</title>${head}</head><body><article><h1>Complexity</h1>${body}</article></body></html>`
}

function pageWithElements(totalElements: number): Uint8Array {
  const paragraphs = totalElements - 17
  return new TextEncoder().encode(complexityHtml(`${BYLINE}${filler(paragraphs)}${TRAILING_BOILERPLATE}`))
}

function pageWithBytes(totalBytes: number): Uint8Array {
  const withPad = (pad: string) => complexityHtml(`${BYLINE}${filler(30)}<p>${pad}</p>${TRAILING_BOILERPLATE}`)
  const padLength = totalBytes - new TextEncoder().encode(withPad('')).byteLength
  const pad = Array.from({ length: padLength }, (_, index) => (index % 60 === 59 ? ' ' : 'a')).join('')
  return new TextEncoder().encode(withPad(pad))
}

function filler(paragraphs: number): string {
  return Array.from(
    { length: paragraphs },
    (_, index) => `<p>Steady sentence ${index} about trusted and untrusted text.</p>`,
  ).join('')
}

function parsedElementCount(bytes: Uint8Array): number {
  return parseHTML(new TextDecoder().decode(bytes)).document.querySelectorAll('*').length
}

describe('extraction cleanup profiles', { timeout: 15_000 }, () => {
  it('gives a document at the element bound full cleanup', async () => {
    const bytes = pageWithElements(FULL_CLEANUP_MAX_ELEMENTS)
    expect(parsedElementCount(bytes)).toBe(FULL_CLEANUP_MAX_ELEMENTS)
    const { article } = await extractArticle({ bytes, url: URL })

    expect(article?.markdown).toContain('Steady sentence 7 ')
    expect(article?.markdown).not.toContain('Related posts')
    for (const marker of BOILERPLATE_MARKERS) expect(article?.markdown).not.toContain(marker)
  })

  it('keeps the article of a document above the element bound, tolerating boilerplate', async () => {
    const bytes = pageWithElements(FULL_CLEANUP_MAX_ELEMENTS + 1)
    expect(parsedElementCount(bytes)).toBe(FULL_CLEANUP_MAX_ELEMENTS + 1)
    const { article } = await extractArticle({ bytes, url: URL })

    expect(article?.markdown).toContain('Steady sentence 7 ')
    for (const marker of BOILERPLATE_MARKERS) expect(article?.markdown).toContain(marker)
  })

  it('gives a document at the byte bound full cleanup', async () => {
    const bytes = pageWithBytes(FULL_CLEANUP_MAX_BYTES)
    expect(bytes.byteLength).toBe(FULL_CLEANUP_MAX_BYTES)
    const { article } = await extractArticle({ bytes, url: URL })

    expect(article?.markdown).toContain('Steady sentence 7 ')
    expect(article?.markdown).not.toContain('Related posts')
    for (const marker of BOILERPLATE_MARKERS) expect(article?.markdown).not.toContain(marker)
  })

  it('keeps the article of a document above the byte bound, tolerating boilerplate', async () => {
    const { article } = await extractArticle({ bytes: pageWithBytes(FULL_CLEANUP_MAX_BYTES + 1), url: URL })

    expect(article?.markdown).toContain('Steady sentence 7 ')
    for (const marker of BOILERPLATE_MARKERS) expect(article?.markdown).toContain(marker)
  })

  it('holds the fast profile to the same Reader Markdown policy', async () => {
    const bytes = new TextEncoder().encode(
      complexityHtml(
        `${HAZARDS}<script type="math/tex; mode=display">E = mc^2</script><pre><code class="language-python">def guard(x):\n    return x</code></pre><table><tr><th>Mitigation</th><th>Holds</th></tr><tr><td>asking nicely</td><td>no</td></tr></table>${filler(5_100)}`,
        JSON_LD,
      ),
    )
    const { article } = await extractArticle({
      bytes,
      url: URL,
      signImageUrl: (url) => `/reader/images?src=${encodeURIComponent(url)}&sig=test`,
    })
    const markdown = article?.markdown ?? ''

    expect(markdown).toContain('Steady sentence 4200 ')
    expect(markdown).toContain('```python')
    expect(markdown).toMatch(/\|\s*Mitigation\s*\|\s*Holds\s*\|/)
    expect(markdown).toContain('E = mc^2')
    expect(markdown).toContain('[safe link](https://publisher.example/writing/next)')
    expect(markdown).toContain('dangerous link')
    expect(markdown).toContain('![a figure](/reader/images?src=')
    expect(markdown).not.toContain('](https://publisher.example/images/figure.png)')
    expect(markdown).not.toContain('<b')
    for (const leak of HAZARD_LEAKS) expect(markdown).not.toContain(leak)
  })
})
