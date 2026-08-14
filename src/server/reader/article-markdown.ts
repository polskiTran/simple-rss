/// <reference lib="dom" />
import { JSDOM } from 'jsdom'
import type { SignImageUrl } from '../images/image-url-signature.js'

export interface ArticleMarkdownOptions {
  /**
   * Rewrites an approved image source to the signed same-origin path. Absent,
   * images are dropped — never emitted with their publisher URL.
   */
  readonly signImageUrl?: SignImageUrl
}

interface Rendering extends ArticleMarkdownOptions {
  readonly baseUrl: string
}

/**
 * Rebuilds extracted article HTML as Markdown through an explicit allowlist. No
 * attribute and no raw HTML ever reaches the output: text is escaped, so a
 * hostile document can only ever say something, never do something.
 */
export function articleMarkdown(html: string, baseUrl: string, options: ArticleMarkdownOptions = {}): string {
  const dom = new JSDOM(html)
  try {
    return blocks(dom.window.document.body, { baseUrl, ...options }).join('\n\n')
  } finally {
    dom.window.close()
  }
}

const DROPPED = new Set([
  'script',
  'style',
  'noscript',
  'template',
  'iframe',
  'frame',
  'frameset',
  'object',
  'embed',
  'applet',
  'video',
  'audio',
  'source',
  'track',
  'svg',
  'canvas',
  'map',
  'area',
  'form',
  'input',
  'button',
  'select',
  'option',
  'optgroup',
  'textarea',
  'label',
  'fieldset',
  'legend',
  'datalist',
  'output',
  'progress',
  'meter',
  'dialog',
  'link',
  'meta',
  'base',
  'title',
])

const INLINE = new Set([
  'a',
  'abbr',
  'b',
  'bdi',
  'bdo',
  'br',
  'cite',
  'code',
  'data',
  'del',
  'dfn',
  'em',
  'i',
  'img',
  'ins',
  'kbd',
  'mark',
  'picture',
  'q',
  's',
  'samp',
  'small',
  'span',
  'strong',
  'sub',
  'sup',
  'time',
  'u',
  'var',
  'wbr',
])

const HEADINGS: Readonly<Record<string, number>> = { h1: 1, h2: 2, h3: 3, h4: 4, h5: 5, h6: 6 }

function blocks(container: ParentNode, context: Rendering): string[] {
  const out: string[] = []
  let run: Node[] = []

  const flush = (): void => {
    const paragraph = paragraphOf(run, context)
    if (paragraph) out.push(paragraph)
    run = []
  }

  for (const node of container.childNodes) {
    if (node.nodeType === node.TEXT_NODE) {
      run.push(node)
      continue
    }
    if (node.nodeType !== node.ELEMENT_NODE) continue

    const element = node as Element
    const tag = element.localName

    if (DROPPED.has(tag)) continue
    if (INLINE.has(tag) || (tag === 'math' && element.getAttribute('display') !== 'block')) {
      run.push(element)
      continue
    }

    flush()

    const level = HEADINGS[tag]
    if (level !== undefined) {
      const text = lines(inlineOf(element, context)).join(' ')
      if (text) out.push(`${'#'.repeat(level)} ${text}`)
    } else if (tag === 'p') {
      const paragraph = paragraphOf([...element.childNodes], context)
      if (paragraph) out.push(paragraph)
    } else if (tag === 'ul' || tag === 'ol') {
      const list = listOf(element, context)
      if (list) out.push(list)
    } else if (tag === 'blockquote') {
      const quoted = blocks(element, context)
      if (quoted.length > 0) {
        out.push(
          quoted
            .join('\n\n')
            .split('\n')
            .map((line) => (line === '' ? '>' : `> ${line}`))
            .join('\n'),
        )
      }
    } else if (tag === 'pre') {
      const fence = fencedCodeOf(element)
      if (fence) out.push(fence)
    } else if (tag === 'table') {
      const table = tableOf(element, context)
      if (table) out.push(table)
    } else if (tag === 'math') {
      const tex = texOf(element)
      if (tex) out.push(`$$\n${tex}\n$$`)
    } else if (tag === 'hr') {
      out.push('---')
    } else {
      out.push(...blocks(element, context))
    }
  }

  flush()
  return out
}

/** Every newline in a run came from a `<br>`, so each is written as a CommonMark hard break (trailing `\`). */
function paragraphOf(nodes: readonly Node[], context: Rendering): string | undefined {
  const text = nodes.map((node) => inlineNode(node, context)).join('')
  const kept = lines(text)
  return kept.length > 0 ? kept.join('\\\n') : undefined
}

function lines(text: string): string[] {
  return text
    .split('\n')
    .map((line) =>
      line
        .replace(/\s+/g, ' ')
        .trim()
        .replace(/^([#>+-]|=)/, '\\$1')
        .replace(/^(\d+)\./, '$1\\.'),
    )
    .filter((line) => line !== '')
}

function inlineOf(element: Element, context: Rendering): string {
  return [...element.childNodes].map((node) => inlineNode(node, context)).join('')
}

function inlineNode(node: Node, context: Rendering): string {
  if (node.nodeType === node.TEXT_NODE) return escapeText(node.textContent ?? '')
  if (node.nodeType !== node.ELEMENT_NODE) return ''

  const element = node as Element
  const tag = element.localName
  if (DROPPED.has(tag)) return ''

  switch (tag) {
    case 'br':
      return '\n'
    case 'code':
    case 'kbd':
    case 'samp': {
      const code = (element.textContent ?? '').replace(/\s+/g, ' ').trim()
      if (!code) return ''
      const ticks = '`'.repeat(longestBacktickRun(code) + 1)
      const pad = code.startsWith('`') || code.endsWith('`') ? ' ' : ''
      return `${ticks}${pad}${code}${pad}${ticks}`
    }
    case 'strong':
    case 'b': {
      const inner = inlineOf(element, context).trim()
      return inner ? `**${inner}**` : ''
    }
    case 'em':
    case 'i': {
      const inner = inlineOf(element, context).trim()
      return inner ? `*${inner}*` : ''
    }
    case 'a': {
      const inner = inlineOf(element, context)
      const destination = safeDestination(element.getAttribute('href'), context)
      if (!inner.trim()) return ''
      return destination ? `[${inner.trim()}](${destination})` : inner
    }
    case 'img': {
      const source = absoluteHttpUrl(element.getAttribute('src'), context)
      if (!source || !context.signImageUrl) return ''
      const alt = escapeText(element.getAttribute('alt') ?? '').trim()
      return `![${alt}](${escapeParentheses(context.signImageUrl(source))})`
    }
    case 'math': {
      const tex = texOf(element)
      return tex ? `$${tex}$` : ''
    }
    default:
      return inlineOf(element, context)
  }
}

function safeDestination(href: string | null, context: Rendering): string | undefined {
  const url = absoluteHttpUrl(href, context)
  return url === undefined ? undefined : escapeParentheses(url)
}

function absoluteHttpUrl(href: string | null, context: Rendering): string | undefined {
  if (href === null) return undefined
  try {
    const url = new URL(href, context.baseUrl)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined
    return url.href
  } catch {
    return undefined
  }
}

/** An unescaped `)` would end the Markdown destination early. */
function escapeParentheses(destination: string): string {
  return destination.replaceAll('(', '%28').replaceAll(')', '%29')
}

function listOf(list: Element, context: Rendering): string | undefined {
  const ordered = list.localName === 'ol'
  const items: string[] = []

  for (const child of list.children) {
    if (child.localName !== 'li') continue
    // Tight on purpose: a nested list or second paragraph continues the item, not a new block.
    const content = blocks(child, context).join('\n')
    if (!content) continue
    const marker = ordered ? `${items.length + 1}. ` : '- '
    // A fixed width, not the marker's: only this dialect's own parser reads
    // the indent back, and `10. ` must not dedent differently from `9. `.
    const indent = ' '.repeat(ordered ? 3 : 2)
    items.push(
      content
        .split('\n')
        .map((line, index) => (index === 0 ? `${marker}${line}` : line === '' ? '' : `${indent}${line}`))
        .join('\n'),
    )
  }

  return items.length > 0 ? items.join('\n') : undefined
}

function fencedCodeOf(pre: Element): string | undefined {
  const code = pre.querySelector('code')
  const text = (code ?? pre).textContent ?? ''
  const trimmed = text.replace(/\n+$/, '').replace(/^\n+/, '')
  if (!trimmed.trim()) return undefined

  const language = /(?:^|\s)(?:language|lang)-([\w+#-]+)/.exec(code?.getAttribute('class') ?? '')?.[1] ?? ''
  const fence = '`'.repeat(Math.max(3, longestBacktickRun(trimmed) + 1))
  return `${fence}${language}\n${trimmed}\n${fence}`
}

function tableOf(table: Element, context: Rendering): string | undefined {
  const rows = [...table.querySelectorAll('tr')].map((row) =>
    [...row.children]
      .filter((cell) => cell.localName === 'td' || cell.localName === 'th')
      .map((cell) => lines(inlineOf(cell, context)).join(' ')),
  )
  const kept = rows.filter((cells) => cells.length > 0)
  const header = kept[0]
  if (!header) return undefined

  const line = (cells: readonly string[]): string => `| ${cells.join(' | ')} |`
  return [line(header), line(header.map(() => '---')), ...kept.slice(1).map(line)].join('\n')
}

/** The `$` delimiters belong to the Markdown, so any inside the formula are dropped rather than ending it early. */
function texOf(math: Element): string {
  const tex = math.getAttribute('data-latex') ?? math.textContent ?? ''
  return tex.replaceAll('$', '').replace(/\s+/g, ' ').trim()
}

function longestBacktickRun(text: string): number {
  let longest = 0
  for (const run of text.matchAll(/`+/g)) longest = Math.max(longest, run[0].length)
  return longest
}

/**
 * Article text may quote Markdown syntax, never speak it. `<` is in the set so
 * text can never round-trip into something tag-shaped.
 */
function escapeText(text: string): string {
  return text.replace(/\s+/g, ' ').replace(/[\\`*_[\]|$~<]/g, '\\$&')
}
