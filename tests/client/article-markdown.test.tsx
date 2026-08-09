import { render } from '@testing-library/react'
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

    // The page h1 is the Feed Item title, so article headings start at h2.
    expect(body.querySelector('h1')).toBeNull()
    expect(body.querySelectorAll('h2')[0]?.textContent).toBe('Top')
    expect(body.querySelectorAll('h3')[0]?.textContent).toBe('Section')
    expect(body.querySelector('p')?.textContent).toBe('Prose.')
  })

  it('renders emphasis, inline code, and hard line breaks', () => {
    const body = bodyOf('a *calm* and **steady** `read()`\nsecond line')

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

  it('renders fenced code without interpreting its contents', () => {
    const body = bodyOf('```python\ndef guard():\n    return **not bold**\n```')

    const code = body.querySelector('pre code')
    expect(code?.textContent).toBe('def guard():\n    return **not bold**')
    expect(code?.querySelector('strong')).toBeNull()
    expect(code?.className).toContain('language-python')
  })

  it('renders tables with a header row', () => {
    const body = bodyOf('| Name | Role |\n| --- | --- |\n| feed | polling |')

    expect(body.querySelectorAll('thead th')).toHaveLength(2)
    const cells = body.querySelectorAll('tbody td')
    expect(cells[0]?.textContent).toBe('feed')
    expect(cells[1]?.textContent).toBe('polling')
  })

  it('shows math as its TeX source', () => {
    const body = bodyOf('Euler wrote $e^{i\\pi} = -1$.\n\n$$\n\\int_0^1 x\\,dx\n$$')

    expect(body.querySelector('.article-math')?.textContent).toBe('e^{i\\pi} = -1')
    expect(body.querySelector('.article-math-display')?.textContent).toBe('\\int_0^1 x\\,dx')
  })

  it('treats escaped syntax and raw HTML as literal text', () => {
    const body = bodyOf('a \\*b\\* \\<img src=x onerror=alert(1)> c\n\n\\# not a heading')

    expect(body.querySelector('img')).toBeNull()
    expect(body.querySelector('h2')).toBeNull()
    expect(body.textContent).toContain('a *b* <img src=x onerror=alert(1)> c')
    expect(body.textContent).toContain('# not a heading')
  })

  it('renders a thematic break between paragraphs', () => {
    expect(bodyOf('one\n\n---\n\ntwo').querySelector('hr')).not.toBeNull()
  })
})
