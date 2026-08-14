import { fireEvent, render, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ArticleMarkdown } from '../../src/client/components/article-markdown.js'

function bodyOf(markdown: string): HTMLElement {
  const { container } = render(<ArticleMarkdown markdown={markdown} />)
  const body = container.querySelector('.article-body')
  if (!(body instanceof HTMLElement)) throw new Error('the article body did not render')
  return body
}

describe('article markdown rendering', () => {
  it('renders headings one level under the article title', () => {
    const body = bodyOf('# Top\n\n## Section\n\nProse.')

    expect(body.querySelector('h1')).toBeNull()
    expect(body.querySelectorAll('h2')[0]?.textContent).toBe('Top')
    expect(body.querySelectorAll('h3')[0]?.textContent).toBe('Section')
    expect(body.querySelector('p')?.textContent).toBe('Prose.')
  })

  it('renders emphasis, inline code, and hard line breaks', () => {
    const body = bodyOf('a *calm* and **steady** `read()`\\\nsecond line')

    const paragraph = body.querySelector('p')
    expect(paragraph?.querySelector('em')?.textContent).toBe('calm')
    expect(paragraph?.querySelector('strong')?.textContent).toBe('steady')
    expect(paragraph?.querySelector('code')?.textContent).toBe('read()')
    expect(paragraph?.querySelector('br')).not.toBeNull()
  })

  it('renders links as clearly external with safe opener behaviour', () => {
    const body = bodyOf('See [the notes](https://publisher.example/notes).')

    const link = body.querySelector('a')
    expect(link?.textContent).toBe('the notes')
    expect(link?.getAttribute('href')).toBe('https://publisher.example/notes')
    expect(link?.getAttribute('target')).toBe('_blank')
    expect(link?.getAttribute('rel')).toBe('noopener noreferrer')
    expect(link?.className).toBe('article-link')
  })

  it('refuses link destinations that are not http or https', () => {
    const body = bodyOf('[run](javascript:alert(1)) and [read](https://ok.example/)')

    const links = body.querySelectorAll('a')
    expect(links).toHaveLength(1)
    expect(links[0]?.getAttribute('href')).toBe('https://ok.example/')
    expect(body.textContent).toContain('run')
  })

  it('renders nested lists, ordered lists, and quotes', () => {
    const body = bodyOf('- one\n  - inner\n- two\n\n1. first\n2. second\n\n> quoted words')

    const outer = body.querySelector('ul')
    expect(outer?.querySelector('ul')?.textContent).toContain('inner')
    const ordered = body.querySelector('ol')
    expect(ordered?.querySelectorAll('li')).toHaveLength(2)
    expect(body.querySelector('blockquote')?.textContent).toContain('quoted words')
  })

  it('renders fenced code as one element per line, without interpreting it', () => {
    const body = bodyOf('```python\ndef guard():\n    return **not bold**\n```')

    const code = body.querySelector('pre code')
    const linesOfCode = code?.querySelectorAll(':scope > span') ?? []
    expect([...linesOfCode].map((line) => line.textContent)).toEqual(['def guard():', '    return **not bold**'])
    expect(code?.querySelector('strong')).toBeNull()
    expect(body.querySelector('[data-streamdown="code-block"]')?.getAttribute('data-language')).toBe('python')
  })

  it('gives code the renderer’s own chrome, fenced and inline', () => {
    const body = bodyOf('Run `observe()`.\n\n```python\nprint(1)\n```')

    expect(body.querySelector('[data-streamdown="inline-code"]')?.className).toContain('bg-muted')
    expect(body.querySelector('[data-streamdown="code-block"]')?.className).toContain('bg-sidebar')
    expect(body.querySelector('[data-streamdown="code-block-header"]')?.textContent).toBe('python')
    expect(body.querySelector('[data-streamdown="code-block-body"]')?.className).toContain('bg-background')
    expect(body.querySelector('[data-streamdown="code-block-copy-button"]')).not.toBeNull()
    expect(body.querySelector('[data-streamdown="code-block-download-button"]')).not.toBeNull()
  })

  it('colours a language it carries, and leaves one it does not', async () => {
    const body = bodyOf('```python\ndef guard():\n    return 1\n```\n\n```brainfuck\n+[->+]\n```')

    await waitFor(() => {
      const token = body.querySelector('pre code span[style*="--shiki-dark"]')
      expect(token?.getAttribute('style')).toMatch(/--sdm-c:\s*#[0-9a-f]{6}/i)
    })
    expect(body.querySelectorAll('[data-language="brainfuck"] span[style*="--shiki-dark"]')).toHaveLength(0)
  })

  it('renders tables with a header row', () => {
    const body = bodyOf('| Name | Role |\n| --- | --- |\n| feed | polling |')

    expect(body.querySelectorAll('thead th')).toHaveLength(2)
    const cells = body.querySelectorAll('tbody td')
    expect(cells[0]?.textContent).toBe('feed')
    expect(cells[1]?.textContent).toBe('polling')
  })

  it('sets math with KaTeX, inline and as a display block', () => {
    const body = bodyOf('Euler wrote $e^{i\\pi} = -1$.\n\n$$\n\\int_0^1 x\\,dx\n$$')

    expect(body.querySelector('p .katex')).not.toBeNull()
    expect(body.querySelector('.katex-display')).not.toBeNull()
    const sources = [...body.querySelectorAll('annotation')].map((source) => source.textContent)
    expect(sources).toEqual(['e^{i\\pi} = -1', '\\int_0^1 x\\,dx'])
  })

  it('reads an escaped dollar as a dollar, not as an opening delimiter', () => {
    const body = bodyOf('a \\$5 note and a \\$9 one')

    expect(body.querySelector('.katex')).toBeNull()
    expect(body.textContent).toBe('a $5 note and a $9 one')
  })

  it('treats escaped syntax and raw HTML as literal text', () => {
    const body = bodyOf('a \\*b\\* \\<img src=x onerror=alert(1)> c\n\n\\# not a heading')

    expect(body.querySelector('img')).toBeNull()
    expect(body.querySelector('h2')).toBeNull()
    expect(body.textContent).toContain('a *b* <img src=x onerror=alert(1)> c')
    expect(body.textContent).toContain('# not a heading')
  })

  it('renders no element from raw HTML, escaped or not', () => {
    const body = bodyOf('a \\<img src=x onerror=alert(1)> c\n\n<img src=y onerror=alert(1)>\n\n<b>bold</b>')

    expect(body.querySelector('img')).toBeNull()
    expect(body.querySelector('b')).toBeNull()
    expect(body.textContent).toContain('a <img src=x onerror=alert(1)> c')
  })

  it('renders a thematic break between paragraphs', () => {
    expect(bodyOf('one\n\n---\n\ntwo').querySelector('hr')).not.toBeNull()
  })
})

describe('article images', () => {
  const SIGNED = '/api/reader/image?url=https%3A%2F%2Fpress.example%2Fa.jpg&exp=99&sig=mac'

  it('renders a proxied image lazily with its alt text', () => {
    const body = bodyOf(`![First \\[light\\]](${SIGNED})`)

    const image = body.querySelector('img')
    expect(image?.getAttribute('src')).toBe(SIGNED)
    expect(image?.getAttribute('alt')).toBe('First [light]')
    expect(image?.getAttribute('loading')).toBe('lazy')
    expect(image?.className).toBe('article-image')
  })

  it('renders no image from anywhere but the signed proxy route', () => {
    const body = bodyOf('![leak](https://tracker.example/pixel.png) then ![wrong route](/api/items/1/image)')

    expect(body.querySelector('img')).toBeNull()
    expect(body.textContent).toContain('leak')
    expect(body.textContent).toContain('wrong route')
  })

  it('shows a stable fallback in place of an image that cannot load', () => {
    const body = bodyOf(`![First light](${SIGNED})`)
    const image = body.querySelector('img')
    if (!image) throw new Error('the image did not render')

    fireEvent.error(image)

    expect(body.querySelector('img')).toBeNull()
    expect(body.querySelector('.article-image-fallback')?.textContent).toContain('First light')
  })

  it('renders an image a publisher linked as one linked image', () => {
    const body = bodyOf(`[![Zero-Mem](${SIGNED})](https://press.example/full/a.jpg)`)

    const link = body.querySelector('a')
    expect(link?.getAttribute('href')).toBe('https://press.example/full/a.jpg')
    expect(link?.querySelector('img')?.getAttribute('src')).toBe(SIGNED)
    expect(link?.querySelector('img')?.getAttribute('alt')).toBe('Zero-Mem')
    expect(body.textContent).toBe('')
  })

  it('keeps a linked image out of the page when only the destination is safe', () => {
    const body = bodyOf('[![leak](https://tracker.example/pixel.png)](https://press.example/a)')

    expect(body.querySelector('img')).toBeNull()
    expect(body.querySelector('a')?.textContent).toBe('leak')
  })

  it('falls back calmly even without alt text', () => {
    const body = bodyOf(`![](${SIGNED})`)
    const image = body.querySelector('img')
    if (!image) throw new Error('the image did not render')

    fireEvent.error(image)

    expect(body.querySelector('.article-image-fallback')?.textContent).toBe('image unavailable')
  })
})
