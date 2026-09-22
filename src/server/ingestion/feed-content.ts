import { parseHTML } from 'linkedom'
import type { BlockContent, ListItem, PhrasingContent, Root, RootContent, TableRow } from 'mdast'
import { FEED_CONTENT_MAX_BYTES } from '../../shared/api.js'
import { readerMarkdownTree, serializeReaderMarkdown } from '../markdown/markdown-policy.js'

// A Feed document is already bounded by Retrieval. Each body's DOM and AST also
// have ceilings so one entry cannot monopolize conversion or recursive traversal.
const MAX_INPUT_CHARACTERS = 512 * 1024
const MAX_NODES = 20_000
const MAX_DEPTH = 64
const MAX_TABLE_COLUMNS = 64
const MAX_TABLE_ROWS = 512

// Unknown elements are transparent so their prose survives; these carry no prose
// a reader should see and drop with everything inside them.
const NON_PROSE_ELEMENTS = new Set([
  'script',
  'style',
  'template',
  'noscript',
  'iframe',
  'frame',
  'object',
  'embed',
  'applet',
  'svg',
  'canvas',
  'audio',
  'video',
  'form',
  'button',
  'input',
  'select',
  'textarea',
])

type HtmlNode = ReturnType<typeof parseHTML>['document']['body']['children'][number]
type DomNode = HtmlNode['childNodes'][number]

export interface FeedContentContext {
  readonly xmlBase: string
  readonly linkBase: string
}

export interface NormalizedFeedContent {
  readonly markdown: string
  readonly truncated: boolean
  readonly plainText: string
}

/** Converts publisher HTML or literal Atom text once, keeping summary and body in agreement. */
export function normalizeFeedContent(
  source: string,
  format: 'text' | 'html',
  context: FeedContentContext,
): NormalizedFeedContent | null {
  const input = unicodePrefix(source, MAX_INPUT_CHARACTERS)
  const budget = {
    nodes: MAX_NODES,
    destinationCharacters: MAX_INPUT_CHARACTERS,
    truncated: input.length < source.length,
  }
  const tree: Root =
    format === 'text'
      ? { type: 'root', children: [{ type: 'paragraph', children: [{ type: 'text', value: input }] }] }
      : {
          type: 'root',
          children: htmlBlocks(
            parseHTML(`<html><body>${input}</body></html>`).document.body.childNodes,
            context,
            budget,
            0,
          ),
        }
  const safe = readerMarkdownTree(tree, { baseUrl: context.linkBase, images: 'preserve' })
  const plainText = textOf(safe).replace(/\s+/g, ' ').trim()
  if (!plainText && !containsImage(safe)) return null
  const full = serializeReaderMarkdown(safe)
  const stored = boundedMarkdown(safe, full)
  return stored.markdown
    ? { markdown: stored.markdown, truncated: budget.truncated || stored.truncated, plainText }
    : null
}

type Budget = { nodes: number; destinationCharacters: number; truncated: boolean }

/** Exhaustion stops all walkers and records application truncation. */
function consumeNode(budget: Budget, depth: number): boolean {
  if (budget.nodes-- > 0 && depth < MAX_DEPTH) return true
  budget.nodes = 0
  budget.truncated = true
  return false
}

function htmlBlocks(
  nodes: Iterable<DomNode>,
  context: FeedContentContext,
  budget: Budget,
  depth: number,
): BlockContent[] {
  const blocks: BlockContent[] = []
  let phrases: PhrasingContent[] = []
  const flush = () => {
    if (phrases.some((node) => node.type !== 'text' || node.value.trim()))
      blocks.push({ type: 'paragraph', children: phrases })
    phrases = []
  }
  for (const node of nodes) {
    if (!consumeNode(budget, depth)) break
    if (node.nodeType === 3) {
      phrases.push({ type: 'text', value: (node.textContent ?? '').replace(/\s+/g, ' ') })
      continue
    }
    if (node.nodeType !== 1) continue
    // SAFETY: DOM nodeType 1 identifies an Element in this parsed document.
    const element = node as HtmlNode
    const tag = localTag(element)
    const base = declaredBase(element, context)
    if (
      [
        'p',
        'div',
        'section',
        'article',
        'main',
        'header',
        'footer',
        'figure',
        'figcaption',
        'aside',
        'address',
        'dl',
        'dt',
        'dd',
        'details',
        'summary',
        'hgroup',
      ].includes(tag)
    ) {
      flush()
      blocks.push(...htmlBlocks(element.childNodes, base, budget, depth + 1))
      continue
    }
    if (/^h[1-6]$/.test(tag)) {
      flush()
      // SAFETY: the heading tag check restricts this digit to 1 through 6.
      const headingDepth = Number(tag[1]) as 1 | 2 | 3 | 4 | 5 | 6
      blocks.push({
        type: 'heading',
        depth: headingDepth,
        children: htmlPhrases(element.childNodes, base, budget, depth + 1),
      })
    } else if (tag === 'blockquote') {
      flush()
      blocks.push({ type: 'blockquote', children: htmlBlocks(element.childNodes, base, budget, depth + 1) })
    } else if (tag === 'ul' || tag === 'ol') {
      flush()
      const start = Number(element.getAttribute('start') ?? 1)
      const children: ListItem[] = []
      for (const child of element.children) {
        if (!consumeNode(budget, depth)) break
        if (localTag(child) !== 'li') continue
        children.push({
          type: 'listItem',
          children: htmlBlocks(child.childNodes, declaredBase(child, base), budget, depth + 1),
        })
      }
      blocks.push({
        type: 'list',
        ordered: tag === 'ol',
        start: Number.isSafeInteger(start) && start >= 0 ? start : 1,
        spread: false,
        children,
      })
    } else if (tag === 'pre') {
      flush()
      const language = /(?:^|\s)language-([\w+#.-]+)/.exec(element.firstElementChild?.getAttribute('class') ?? '')?.[1]
      // Language metadata must not consume the body budget before any code fits.
      const acceptedLanguage = language && language.length <= 64 ? language : undefined
      if (language && !acceptedLanguage) budget.truncated = true
      blocks.push({
        type: 'code',
        value: element.textContent ?? '',
        ...(acceptedLanguage ? { lang: acceptedLanguage } : {}),
      })
    } else if (tag === 'hr') {
      flush()
      blocks.push({ type: 'thematicBreak' })
    } else if (tag === 'table') {
      flush()
      const rows: TableRow[] = []
      for (const { row, base: rowBase } of tableRows(element, base, budget, depth + 1)) {
        if (rows.length >= MAX_TABLE_ROWS) {
          budget.nodes = 0
          budget.truncated = true
          break
        }
        const cells = [...row.children].filter((cell) => ['td', 'th'].includes(localTag(cell)))
        rows.push({
          type: 'tableRow',
          children: cells.slice(0, MAX_TABLE_COLUMNS).map((cell) => ({
            type: 'tableCell',
            children: htmlPhrases(cell.childNodes, declaredBase(cell, rowBase), budget, depth + 1),
          })),
        })
        if (cells.length > MAX_TABLE_COLUMNS) {
          budget.nodes = 0
          budget.truncated = true
          break
        }
      }
      if (rows.length) blocks.push({ type: 'table', children: rows })
    } else {
      phrases.push(...htmlPhrase(element, context, budget, depth + 1))
    }
  }
  flush()
  return blocks
}

/** Walk table sections without losing their XML bases or entering nested tables. */
function* tableRows(
  element: HtmlNode,
  context: FeedContentContext,
  budget: Budget,
  depth: number,
): Generator<{ row: HtmlNode; base: FeedContentContext }> {
  for (const child of element.children) {
    if (!consumeNode(budget, depth)) break
    const tag = localTag(child)
    const base = declaredBase(child, context)
    if (tag === 'tr') yield { row: child, base }
    else if (['thead', 'tbody', 'tfoot'].includes(tag)) yield* tableRows(child, base, budget, depth + 1)
  }
}

function htmlPhrases(
  nodes: Iterable<DomNode>,
  context: FeedContentContext,
  budget: Budget,
  depth: number,
): PhrasingContent[] {
  const phrases: PhrasingContent[] = []
  for (const node of nodes) {
    if (!consumeNode(budget, depth)) break
    if (node.nodeType === 3) phrases.push({ type: 'text', value: (node.textContent ?? '').replace(/\s+/g, ' ') })
    else if (node.nodeType === 1) {
      // SAFETY: DOM nodeType 1 identifies an Element in this parsed document.
      phrases.push(...htmlPhrase(node as HtmlNode, context, budget, depth + 1))
    }
  }
  return phrases
}

function htmlPhrase(element: HtmlNode, context: FeedContentContext, budget: Budget, depth: number): PhrasingContent[] {
  const tag = localTag(element)
  const base = declaredBase(element, context)
  if (tag === 'br') return [{ type: 'break' }]
  if (tag === 'code' || tag === 'kbd' || tag === 'samp')
    return [{ type: 'inlineCode', value: element.textContent ?? '' }]
  if (tag === 'img') {
    const url = destination(element.getAttribute('src'), base.linkBase, budget)
    return url
      ? [{ type: 'image', url, alt: element.getAttribute('alt') ?? '', title: element.getAttribute('title') }]
      : []
  }
  if (tag === 'math') {
    const tex = element.querySelector('annotation[encoding="application/x-tex"]')?.textContent
    return tex ? [{ type: 'inlineMath', value: tex }] : []
  }
  if (NON_PROSE_ELEMENTS.has(tag)) return []
  const children = htmlPhrases(element.childNodes, base, budget, depth)
  if (tag === 'em' || tag === 'i') return [{ type: 'emphasis', children }]
  if (tag === 'strong' || tag === 'b') return [{ type: 'strong', children }]
  if (tag === 'a') {
    const url = destination(element.getAttribute('href'), base.linkBase, budget)
    return url ? [{ type: 'link', url, children }] : children
  }
  return children
}

/** Bound both authored destinations and amplification from inherited bases. */
function destination(candidate: string | null, baseUrl: string, budget: Budget): string | undefined {
  if (!candidate?.trim()) return undefined
  if (candidate.length > 4096) {
    budget.truncated = true
    return undefined
  }
  try {
    const url = new URL(candidate, baseUrl).href
    if (url.length > 4096 || url.length > budget.destinationCharacters) {
      budget.truncated = true
      return undefined
    }
    budget.destinationCharacters -= url.length
    return url
  } catch {
    return undefined
  }
}

/** XML declarations inherit from the document, never the alternate webpage fallback. */
function declaredBase(element: HtmlNode, context: FeedContentContext): FeedContentContext {
  const declared = element.getAttribute('xml:base')
  if (declared === null) return context
  try {
    const base = new URL(declared, context.xmlBase).href
    return { xmlBase: base, linkBase: base }
  } catch {
    return context
  }
}

function containsImage(node: Root | RootContent): boolean {
  return node.type === 'image' || ('children' in node && node.children.some(containsImage))
}

function textOf(node: Root | RootContent): string {
  if (node.type === 'break') return ' '
  if ('value' in node) return node.value
  if ('children' in node)
    return node.children
      .map(textOf)
      .join(['paragraph', 'heading', 'emphasis', 'strong', 'link', 'delete'].includes(node.type) ? '' : ' ')
  return ''
}

/** Cut the AST, not serialized Markdown: fences, links, nesting and Unicode stay closed. */
function boundedMarkdown(tree: Root, full: string) {
  if (Buffer.byteLength(full) <= FEED_CONTENT_MAX_BYTES) return { markdown: full, truncated: false }
  let low = 0
  let high = full.length
  let markdown = ''
  while (low <= high) {
    const middle = Math.floor((low + high) / 2)
    const prefix = prefixTree(tree, { remaining: middle })
    const candidate = serializeReaderMarkdown(prefix)
    if (Buffer.byteLength(candidate) <= FEED_CONTENT_MAX_BYTES) {
      markdown = candidate
      low = middle + 1
    } else high = middle - 1
  }
  return { markdown, truncated: true }
}

function prefixTree<Node extends Root | RootContent>(node: Node, budget: { remaining: number }): Node {
  if (node.type === 'image') {
    // Keep the destination whole; alternative text and title can form a readable prefix.
    budget.remaining -= node.url.length + 1
    const alt = unicodePrefix(node.alt ?? '', Math.max(0, budget.remaining))
    budget.remaining -= alt.length
    const title = unicodePrefix(node.title ?? '', Math.max(0, budget.remaining))
    budget.remaining -= title.length
    return { ...node, alt, title }
  }
  if ('value' in node) {
    const value = unicodePrefix(node.value, Math.max(0, budget.remaining))
    budget.remaining -= value.length
    return { ...node, value }
  }
  if ('children' in node) {
    const children = []
    for (const child of node.children) {
      if (budget.remaining <= 0) break
      budget.remaining -= 1
      children.push(prefixTree(child, budget))
    }
    return { ...node, children }
  }
  budget.remaining -= 1
  return node
}

function unicodePrefix(value: string, length: number): string {
  const end = Math.min(value.length, length)
  const last = value.charCodeAt(end - 1)
  return value.slice(0, last >= 0xd800 && last <= 0xdbff ? end - 1 : end)
}

/** HTML parsing keeps XHTML prefixes in localName; the allowlist uses the local tag. */
function localTag(element: HtmlNode): string {
  return element.localName.split(':').at(-1)?.toLowerCase() ?? ''
}
