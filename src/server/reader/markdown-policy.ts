import type {
  BlockContent,
  Blockquote,
  Code,
  Heading,
  Image,
  Link,
  List,
  ListItem,
  Paragraph,
  PhrasingContent,
  Root,
  RootContent,
  Table,
  TableCell,
  TableRow,
} from 'mdast'
import { fromMarkdown } from 'mdast-util-from-markdown'
import { gfmTableFromMarkdown, gfmTableToMarkdown } from 'mdast-util-gfm-table'
import { mathFromMarkdown, mathToMarkdown } from 'mdast-util-math'
import { toMarkdown } from 'mdast-util-to-markdown'
import { gfmTable } from 'micromark-extension-gfm-table'
import { math } from 'micromark-extension-math'
import type { SignImageUrl } from '../images/image-url-signature.js'

const PARSER_OPTIONS = {
  extensions: [gfmTable(), math({ singleDollarTextMath: false })],
  mdastExtensions: [gfmTableFromMarkdown(), mathFromMarkdown()],
}

const SERIALIZER_OPTIONS = {
  bullet: '-' as const,
  emphasis: '*' as const,
  extensions: [gfmTableToMarkdown(), mathToMarkdown({ singleDollarTextMath: false })],
  fence: '`' as const,
  fences: true,
  listItemIndent: 'one' as const,
  resourceLink: true,
  rule: '-' as const,
  strong: '*' as const,
}

const CODE_LANGUAGE = /^[\w+#.-]+$/u

export interface ReaderMarkdownPolicyOptions {
  /** The final page address reported by Retrieval. */
  readonly baseUrl: string
  /** Images are omitted unless they can be replaced with a signed Reader path. */
  readonly signImageUrl?: SignImageUrl
}

type PolicyContext = ReaderMarkdownPolicyOptions

/**
 * Rebuilds Defuddle Markdown from the Reader dialect's maintained AST nodes.
 * Unknown syntax and raw HTML are omitted rather than passed through.
 */
export function applyReaderMarkdownPolicy(markdown: string, options: ReaderMarkdownPolicyOptions): string {
  const parsed = fromMarkdown(markdown, PARSER_OPTIONS)
  const root: Root = { type: 'root', children: policyBlocks(parsed.children, options) }
  return toMarkdown(root, SERIALIZER_OPTIONS).trim()
}

function policyBlocks(nodes: readonly RootContent[], context: PolicyContext): BlockContent[] {
  return nodes.flatMap((node) => policyBlock(node, context))
}

function policyBlock(node: RootContent, context: PolicyContext): BlockContent[] {
  switch (node.type) {
    case 'paragraph': {
      const children = policyPhrasing(node.children, context)
      return children.length === 0 ? [] : [{ type: 'paragraph', children } satisfies Paragraph]
    }
    case 'heading': {
      const children = policyPhrasing(node.children, context)
      return children.length === 0 ? [] : [{ type: 'heading', depth: node.depth, children } satisfies Heading]
    }
    case 'blockquote': {
      const children = policyBlocks(node.children, context)
      return children.length === 0 ? [] : [{ type: 'blockquote', children } satisfies Blockquote]
    }
    case 'list':
      return policyList(node, context)
    case 'code': {
      const language = node.lang?.trim()
      const code: Code = {
        type: 'code',
        value: node.value,
        ...(language && CODE_LANGUAGE.test(language) ? { lang: language } : {}),
      }
      return [code]
    }
    case 'thematicBreak':
      return [{ type: 'thematicBreak' }]
    case 'table':
      return policyTable(node, context)
    case 'math':
      return [{ type: 'math', value: node.value }]
    default:
      return []
  }
}

function policyList(node: List, context: PolicyContext): BlockContent[] {
  const children = node.children.flatMap((item) => policyListItem(item, context))
  if (children.length === 0) return []

  const list: List = {
    type: 'list',
    ordered: node.ordered ?? false,
    spread: node.spread ?? false,
    children,
    ...(node.start !== null && node.start !== undefined ? { start: node.start } : {}),
  }
  return [list]
}

function policyListItem(node: ListItem, context: PolicyContext): ListItem[] {
  const children = policyBlocks(node.children, context)
  return children.length === 0 ? [] : [{ type: 'listItem', spread: node.spread ?? false, children } satisfies ListItem]
}

function policyTable(node: Table, context: PolicyContext): BlockContent[] {
  const children = node.children.map(
    (row) =>
      ({
        type: 'tableRow',
        children: row.children.map(
          (cell) =>
            ({
              type: 'tableCell',
              children: policyPhrasing(cell.children, context),
            }) satisfies TableCell,
        ),
      }) satisfies TableRow,
  )
  if (children.length === 0) return []

  const table: Table = {
    type: 'table',
    children,
    ...(node.align ? { align: [...node.align] } : {}),
  }
  return [table]
}

function policyPhrasing(nodes: readonly PhrasingContent[], context: PolicyContext): PhrasingContent[] {
  return nodes.flatMap((node) => policyPhrase(node, context))
}

function policyPhrase(node: PhrasingContent, context: PolicyContext): PhrasingContent[] {
  switch (node.type) {
    case 'text':
      return [{ type: 'text', value: node.value }]
    case 'break':
      return [{ type: 'break' }]
    case 'inlineCode':
      return [{ type: 'inlineCode', value: node.value }]
    case 'inlineMath':
      return [{ type: 'inlineMath', value: node.value }]
    case 'emphasis': {
      const children = policyPhrasing(node.children, context)
      return children.length === 0 ? [] : [{ type: 'emphasis', children }]
    }
    case 'strong': {
      const children = policyPhrasing(node.children, context)
      return children.length === 0 ? [] : [{ type: 'strong', children }]
    }
    case 'delete':
    case 'linkReference':
      return policyPhrasing(node.children, context)
    case 'link':
      return policyLink(node, context)
    case 'image':
      return policyImage(node, context)
    default:
      return []
  }
}

function policyLink(node: Link, context: PolicyContext): PhrasingContent[] {
  const children = policyPhrasing(node.children, context)
  if (children.length === 0) return []

  const url = absoluteHttpUrl(node.url, context.baseUrl)
  if (!url) return children

  const link: Link = {
    type: 'link',
    url,
    children,
    ...(node.title ? { title: node.title } : {}),
  }
  return [link]
}

function policyImage(node: Image, context: PolicyContext): PhrasingContent[] {
  if (!context.signImageUrl) return []
  const alt = node.alt?.trim() ?? ''
  const url = absoluteHttpUrl(node.url, context.baseUrl)
  if (!url) return []

  const image: Image = {
    type: 'image',
    url: context.signImageUrl(url),
    alt,
    ...(node.title ? { title: node.title } : {}),
  }
  return [image]
}

function absoluteHttpUrl(candidate: string, baseUrl: string): string | undefined {
  try {
    const url = new URL(candidate, baseUrl)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : undefined
  } catch {
    return undefined
  }
}
