import { Fragment, useState, type ReactNode } from 'react'
import { READER_IMAGE_PATH } from '../../shared/api.js'

/**
 * Renders the constrained Markdown the server's Reader extraction generates.
 *
 * This is the other half of `src/server/reader/article-markdown.ts`: the same
 * small dialect, read back into React elements. Everything unrecognised stays
 * literal text — there is no raw-HTML path on either side, so a hostile
 * article can change what the Reader says but never what it does.
 */
export function ArticleMarkdown({ markdown }: { readonly markdown: string }) {
  return <div className="article-body">{blocks(parseBlocks(markdown.split('\n')))}</div>
}

type Block =
  | { readonly kind: 'heading'; readonly level: number; readonly text: string }
  | { readonly kind: 'paragraph'; readonly text: string }
  | { readonly kind: 'list'; readonly ordered: boolean; readonly items: Block[][] }
  | { readonly kind: 'quote'; readonly children: Block[] }
  | { readonly kind: 'code'; readonly language: string; readonly code: string }
  | { readonly kind: 'table'; readonly header: string[]; readonly rows: string[][] }
  | { readonly kind: 'math'; readonly tex: string }
  | { readonly kind: 'rule' }

const HEADING = /^(#{1,6}) (.*)$/
const FENCE = /^(`{3,})([\w+#-]*)\s*$/
const LIST_ITEM = /^(?:- |\d+\. )/
const ORDERED_ITEM = /^\d+\. /
const TABLE_DIVIDER = /^\|(?:\s*-{3,}\s*\|)+\s*$/

function parseBlocks(lines: readonly string[]): Block[] {
  const out: Block[] = []
  let index = 0

  while (index < lines.length) {
    const line = lines[index] ?? ''
    if (line.trim() === '') {
      index += 1
      continue
    }

    const fence = FENCE.exec(line)
    if (fence) {
      const closing = new RegExp(`^\`{${fence[1]?.length ?? 3},}\\s*$`)
      const code: string[] = []
      index += 1
      while (index < lines.length && !closing.test(lines[index] ?? '')) {
        code.push(lines[index] ?? '')
        index += 1
      }
      index += 1
      out.push({ kind: 'code', language: fence[2] ?? '', code: code.join('\n') })
      continue
    }

    if (line.trim() === '$$') {
      const tex: string[] = []
      index += 1
      while (index < lines.length && (lines[index] ?? '').trim() !== '$$') {
        tex.push(lines[index] ?? '')
        index += 1
      }
      index += 1
      out.push({ kind: 'math', tex: tex.join('\n').trim() })
      continue
    }

    const heading = HEADING.exec(line)
    if (heading) {
      out.push({ kind: 'heading', level: heading[1]?.length ?? 1, text: heading[2] ?? '' })
      index += 1
      continue
    }

    if (line.trim() === '---') {
      out.push({ kind: 'rule' })
      index += 1
      continue
    }

    if (line.startsWith('>')) {
      const quoted: string[] = []
      while (index < lines.length && (lines[index] ?? '').startsWith('>')) {
        quoted.push((lines[index] ?? '').replace(/^> ?/, ''))
        index += 1
      }
      out.push({ kind: 'quote', children: parseBlocks(quoted) })
      continue
    }

    if (LIST_ITEM.test(line)) {
      const collected: string[] = []
      while (index < lines.length) {
        const current = lines[index] ?? ''
        if (!LIST_ITEM.test(current) && !/^\s+\S/.test(current)) break
        collected.push(current)
        index += 1
      }
      out.push(parseList(collected))
      continue
    }

    if (line.startsWith('|') && TABLE_DIVIDER.test(lines[index + 1] ?? '')) {
      const header = splitRow(line)
      const rows: string[][] = []
      index += 2
      while (index < lines.length && (lines[index] ?? '').startsWith('|')) {
        rows.push(splitRow(lines[index] ?? ''))
        index += 1
      }
      out.push({ kind: 'table', header, rows })
      continue
    }

    const text: string[] = [line]
    index += 1
    while (index < lines.length) {
      const current = lines[index] ?? ''
      if (
        current.trim() === '' ||
        HEADING.test(current) ||
        FENCE.test(current) ||
        LIST_ITEM.test(current) ||
        current.startsWith('>') ||
        current.startsWith('|') ||
        current.trim() === '---' ||
        current.trim() === '$$'
      ) {
        break
      }
      text.push(current)
      index += 1
    }
    out.push({ kind: 'paragraph', text: text.join('\n') })
  }

  return out
}

function parseList(lines: readonly string[]): Block {
  const ordered = ORDERED_ITEM.test(lines[0] ?? '')
  const items: Block[][] = []
  let item: string[] = []

  const flush = (): void => {
    if (item.length > 0) items.push(parseBlocks(item))
    item = []
  }

  for (const line of lines) {
    if (LIST_ITEM.test(line)) {
      flush()
      item.push(line.replace(LIST_ITEM, ''))
    } else {
      // A continuation: a nested list or a further paragraph of the item,
      // indented by the width the server serialized it with.
      item.push(line.replace(ordered ? /^ {3}/ : /^ {2}/, ''))
    }
  }
  flush()

  return { kind: 'list', ordered, items }
}

/** Table cells, split on pipes that are delimiters rather than escaped text. */
function splitRow(line: string): string[] {
  const cells: string[] = []
  let cell = ''
  for (let index = 1; index < line.length; index += 1) {
    const char = line[index] ?? ''
    if (char === '\\' && index + 1 < line.length) {
      cell += char + (line[index + 1] ?? '')
      index += 1
    } else if (char === '|') {
      cells.push(cell.trim())
      cell = ''
    } else {
      cell += char
    }
  }
  if (cell.trim() !== '') cells.push(cell.trim())
  return cells
}

function blocks(parsed: readonly Block[]): ReactNode[] {
  return parsed.map((block, index) => <Fragment key={index}>{renderBlock(block)}</Fragment>)
}

function renderBlock(block: Block): ReactNode {
  switch (block.kind) {
    case 'heading':
      return renderHeading(block.level, block.text)
    case 'paragraph':
      return <p>{inline(block.text)}</p>
    case 'quote':
      return <blockquote>{blocks(block.children)}</blockquote>
    case 'code':
      return (
        <pre>
          <code className={block.language ? `language-${block.language}` : undefined}>{block.code}</code>
        </pre>
      )
    case 'math':
      return <p className="article-math-display">{block.tex}</p>
    case 'rule':
      return <hr />
    case 'table':
      return (
        <table>
          <thead>
            <tr>
              {block.header.map((cell, index) => (
                <th key={index}>{inline(cell)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {block.rows.map((row, rowIndex) => (
              <tr key={rowIndex}>
                {row.map((cell, cellIndex) => (
                  <td key={cellIndex}>{inline(cell)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )
    case 'list': {
      const items = block.items.map((item, index) => <li key={index}>{blocks(item)}</li>)
      return block.ordered ? <ol>{items}</ol> : <ul>{items}</ul>
    }
  }
}

/**
 * The article's headings sit under the Feed Item title, which is the page's
 * one h1 — so Markdown level n renders one step down.
 */
function renderHeading(level: number, text: string): ReactNode {
  const content = inline(text)
  switch (Math.min(level + 1, 6)) {
    case 2:
      return <h2>{content}</h2>
    case 3:
      return <h3>{content}</h3>
    case 4:
      return <h4>{content}</h4>
    case 5:
      return <h5>{content}</h5>
    default:
      return <h6>{content}</h6>
  }
}

/** Inline Markdown to React nodes. Unmatched syntax falls back to literal text. */
function inline(text: string): ReactNode[] {
  const nodes: ReactNode[] = []
  let buffer = ''
  let key = 0

  const flush = (): void => {
    if (buffer !== '') nodes.push(buffer)
    buffer = ''
  }
  const push = (node: ReactNode): void => {
    flush()
    nodes.push(<Fragment key={key++}>{node}</Fragment>)
  }

  for (let index = 0; index < text.length; ) {
    const char = text[index] ?? ''

    if (char === '\\' && index + 1 < text.length) {
      buffer += text[index + 1]
      index += 2
      continue
    }

    if (char === '\n') {
      push(<br />)
      index += 1
      continue
    }

    if (char === '`') {
      const run = /^`+/.exec(text.slice(index))?.[0] ?? '`'
      const close = text.indexOf(run, index + run.length)
      if (close !== -1 && text[close + run.length] !== '`') {
        const body = text.slice(index + run.length, close)
        push(<code>{body.startsWith(' ') && body.endsWith(' ') ? body.slice(1, -1) : body}</code>)
        index = close + run.length
        continue
      }
    }

    if (text.startsWith('**', index)) {
      const close = indexOfUnescaped(text, '**', index + 2)
      if (close !== -1) {
        push(<strong>{inline(text.slice(index + 2, close))}</strong>)
        index = close + 2
        continue
      }
    }

    if (char === '*') {
      const close = indexOfUnescaped(text, '*', index + 1)
      if (close !== -1) {
        push(<em>{inline(text.slice(index + 1, close))}</em>)
        index = close + 1
        continue
      }
    }

    if (char === '$') {
      const close = indexOfUnescaped(text, '$', index + 1)
      if (close !== -1) {
        push(<span className="article-math">{text.slice(index + 1, close)}</span>)
        index = close + 1
        continue
      }
    }

    if (char === '!' && text[index + 1] === '[') {
      const image = parseLink(text, index + 1)
      if (image) {
        // Only the server's own signed proxy route may become a request; any
        // other source renders as its alt text and asks nobody for anything.
        if (image.destination.startsWith(`${READER_IMAGE_PATH}?`)) {
          push(<ArticleImage src={image.destination} alt={literal(image.text)} />)
        } else {
          push(<Fragment>{inline(image.text)}</Fragment>)
        }
        index = image.end
        continue
      }
    }

    if (char === '[') {
      const link = parseLink(text, index)
      if (link) {
        if (isSafeDestination(link.destination)) {
          push(
            <a className="article-link" href={link.destination} target="_blank" rel="noopener noreferrer">
              {inline(link.text)}
            </a>,
          )
        } else {
          push(<Fragment>{inline(link.text)}</Fragment>)
        }
        index = link.end
        continue
      }
    }

    buffer += char
    index += 1
  }

  flush()
  return nodes
}

/**
 * A proxied article image. The stable fallback for one that cannot load —
 * missing, expired signature, publisher gone — is its alt text in the image's
 * place, so a broken image never becomes a broken page.
 */
function ArticleImage({ src, alt }: { readonly src: string; readonly alt: string }) {
  const [failed, setFailed] = useState(false)

  if (failed) {
    return <span className="article-image-fallback">{alt || 'image unavailable'}</span>
  }
  return (
    <img className="article-image" src={src} alt={alt} loading="lazy" decoding="async" onError={() => setFailed(true)} />
  )
}

/** Markdown-escaped text as the plain words it spells, for an alt attribute. */
function literal(text: string): string {
  return text.replace(/\\(.)/g, '$1')
}

interface ParsedLink {
  readonly text: string
  /** Exactly as written; each caller decides what it is willing to follow. */
  readonly destination: string
  readonly end: number
}

function parseLink(text: string, start: number): ParsedLink | undefined {
  const closeBracket = closingBracket(text, start)
  if (closeBracket === -1 || text[closeBracket + 1] !== '(') return undefined
  const closeParen = text.indexOf(')', closeBracket + 2)
  if (closeParen === -1) return undefined

  return {
    text: text.slice(start + 1, closeBracket),
    destination: text.slice(closeBracket + 2, closeParen),
    end: closeParen + 1,
  }
}

/**
 * The `]` that closes the `[` at `start`, counted rather than found: link text
 * may hold brackets of its own — `[![alt](src)](href)`, the linked image a
 * publisher wraps around a figure — and stopping at the first `]` would end
 * the link early and spill the rest of it into the page as literal text.
 */
function closingBracket(text: string, start: number): number {
  let depth = 0
  for (let index = start; index < text.length; index += 1) {
    const char = text[index]
    if (char === '\\') {
      index += 1
      continue
    }
    if (char === '[') {
      depth += 1
    } else if (char === ']') {
      depth -= 1
      if (depth === 0) return index
    }
  }
  return -1
}

/** The server only writes http(s) destinations; the client refuses anything else anyway. */
function isSafeDestination(destination: string): boolean {
  try {
    const url = new URL(destination)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

function indexOfUnescaped(text: string, delimiter: string, from: number): number {
  for (let index = from; index <= text.length - delimiter.length; index += 1) {
    if (text[index] === '\\') {
      index += 1
      continue
    }
    if (text.startsWith(delimiter, index)) return index
  }
  return -1
}
