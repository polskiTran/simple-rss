/// <reference lib="dom" />
import { JSDOM } from 'jsdom'

/**
 * Turns extracted article HTML into Markdown through an explicit allowlist.
 *
 * Structure the Reader keeps — headings, paragraphs, lists, links, block
 * quotes, tables, code, and supported math — is rebuilt as Markdown syntax;
 * everything else either unwraps to its text or, for active and embedded
 * content, disappears with its children. No attribute and no raw HTML ever
 * reaches the output: text is escaped, so a hostile document can only ever
 * say something, never do something.
 */
export function articleMarkdown(html: string, baseUrl: string): string {
  const dom = new JSDOM(html)
  try {
    return blocks(dom.window.document.body, baseUrl).join('\n\n')
  } finally {
    dom.window.close()
  }
}

/**
 * Elements whose content must vanish with them: running one of these in a
 * reading surface is exactly what Reader View exists to prevent. Images stay
 * out too until they can be proxied behind signed URLs.
 */
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
  'picture',
  'img',
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

/** Phrasing content that joins the surrounding text rather than breaking it. */
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
  'ins',
  'kbd',
  'mark',
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

/** Serializes one container's children as a sequence of Markdown blocks. */
function blocks(container: ParentNode, baseUrl: string): string[] {
  const out: string[] = []
  /** Consecutive phrasing nodes waiting to become one paragraph. */
  let run: Node[] = []

  const flush = (): void => {
    const paragraph = paragraphOf(run, baseUrl)
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
      const text = lines(inlineOf(element, baseUrl)).join(' ')
      if (text) out.push(`${'#'.repeat(level)} ${text}`)
    } else if (tag === 'p') {
      const paragraph = paragraphOf([...element.childNodes], baseUrl)
      if (paragraph) out.push(paragraph)
    } else if (tag === 'ul' || tag === 'ol') {
      const list = listOf(element, baseUrl)
      if (list) out.push(list)
    } else if (tag === 'blockquote') {
      const quoted = blocks(element, baseUrl)
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
      const table = tableOf(element, baseUrl)
      if (table) out.push(table)
    } else if (tag === 'math') {
      const tex = texOf(element)
      if (tex) out.push(`$$\n${tex}\n$$`)
    } else if (tag === 'hr') {
      out.push('---')
    } else {
      // Anything else — div, section, figure, article — is only a container
      // here: its children speak, the wrapper itself has nothing to add.
      out.push(...blocks(element, baseUrl))
    }
  }

  flush()
  return out
}

/** One paragraph from a run of phrasing nodes, or nothing worth keeping. */
function paragraphOf(nodes: readonly Node[], baseUrl: string): string | undefined {
  const text = nodes.map((node) => inlineNode(node, baseUrl)).join('')
  const kept = lines(text)
  return kept.length > 0 ? kept.join('\n') : undefined
}

/**
 * Splits rendered phrasing content into trimmed lines and escapes anything
 * that would otherwise begin a Markdown block on its own line.
 */
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

function inlineOf(element: Element, baseUrl: string): string {
  return [...element.childNodes].map((node) => inlineNode(node, baseUrl)).join('')
}

function inlineNode(node: Node, baseUrl: string): string {
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
      const inner = inlineOf(element, baseUrl).trim()
      return inner ? `**${inner}**` : ''
    }
    case 'em':
    case 'i': {
      const inner = inlineOf(element, baseUrl).trim()
      return inner ? `*${inner}*` : ''
    }
    case 'a': {
      const inner = inlineOf(element, baseUrl)
      const destination = safeDestination(element.getAttribute('href'), baseUrl)
      if (!inner.trim()) return ''
      return destination ? `[${inner.trim()}](${destination})` : inner
    }
    case 'math': {
      const tex = texOf(element)
      return tex ? `$${tex}$` : ''
    }
    default:
      return inlineOf(element, baseUrl)
  }
}

/**
 * A link destination the Reader will follow: absolute after resolution
 * against the article, and plain http or https — nothing executable, nothing
 * that smuggles a document inline.
 */
function safeDestination(href: string | null, baseUrl: string): string | undefined {
  if (href === null) return undefined
  try {
    const url = new URL(href, baseUrl)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined
    return url.href.replaceAll('(', '%28').replaceAll(')', '%29')
  } catch {
    return undefined
  }
}

function listOf(list: Element, baseUrl: string): string | undefined {
  const ordered = list.localName === 'ol'
  const items: string[] = []

  for (const child of list.children) {
    if (child.localName !== 'li') continue
    // Tight on purpose: inside an item, a nested list or second paragraph
    // continues the item rather than opening a new block.
    const content = blocks(child, baseUrl).join('\n')
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

function tableOf(table: Element, baseUrl: string): string | undefined {
  const rows = [...table.querySelectorAll('tr')].map((row) =>
    [...row.children]
      .filter((cell) => cell.localName === 'td' || cell.localName === 'th')
      .map((cell) => lines(inlineOf(cell, baseUrl)).join(' ')),
  )
  const kept = rows.filter((cells) => cells.length > 0)
  const header = kept[0]
  if (!header) return undefined

  const line = (cells: readonly string[]): string => `| ${cells.join(' | ')} |`
  return [line(header), line(header.map(() => '---')), ...kept.slice(1).map(line)].join('\n')
}

/**
 * The TeX behind a normalized `<math>` element. The `$` delimiters belong to
 * the Markdown, so any that appear inside the formula are dropped rather than
 * allowed to end it early.
 */
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
 * Article text may quote Markdown syntax; it must never speak it. `<` is in
 * the set so text can never round-trip into something tag-shaped either.
 */
function escapeText(text: string): string {
  return text.replace(/\s+/g, ' ').replace(/[\\`*_[\]|$~<]/g, '\\$&')
}
