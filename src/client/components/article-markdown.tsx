import { createMathPlugin } from '@streamdown/math'
import type { Element, Root, RootContent } from 'hast'
// KaTeX's own stylesheet, self-hosted with its fonts for the same reason
// Literata is: math renders without a third-party request. It loads with this
// module, so a User who never opens an article never fetches it.
import 'katex/dist/katex.min.css'
import { type ComponentProps, useState } from 'react'
import { Streamdown, type Components, type PluginConfig, defaultRehypePlugins } from 'streamdown'
import { READER_IMAGE_PATH } from '../../shared/api.js'
import { articleCode } from './article-code.js'

/**
 * Renders the constrained Markdown the server's Reader extraction generates.
 *
 * Streamdown parses it — CommonMark plus GFM tables, with KaTeX for the math
 * and Shiki for fenced code. What the article may *do* is still decided here
 * rather than by the parser: raw HTML has no path through (`src/server/reader/
 * article-markdown.ts` escapes it, and rehype-raw is left out below), links
 * and images pass through the components at the bottom of this file, and a
 * hostile article can therefore change what the Reader says but never what it
 * does.
 */
export function ArticleMarkdown({ markdown }: { readonly markdown: string }) {
  return (
    <Streamdown className="article-body" mode="static" plugins={PLUGINS} rehypePlugins={REHYPE_PLUGINS} components={COMPONENTS}>
      {markdown}
    </Streamdown>
  )
}

const PLUGINS: PluginConfig = {
  code: articleCode,
  // Single-dollar inline math is safe to read as math here: the server
  // escapes every literal `$` in article text, so an unescaped one is
  // always a delimiter it wrote.
  math: createMathPlugin({ singleDollarTextMath: true }),
}

/** Streamdown's defaults minus rehype-raw: this dialect has no raw-HTML path. */
const { raw, ...keptRehypePlugins } = defaultRehypePlugins
const REHYPE_PLUGINS = [...Object.values(keptRehypePlugins), shiftHeadings]

/**
 * The article's headings sit under the Feed Item title, which is the page's
 * one h1, so every one of them moves a level down. Rewriting the tree rather
 * than swapping components means Streamdown still draws the heading, at the
 * size that belongs to the level it now is.
 */
function shiftHeadings() {
  return (tree: Root): void => {
    visitElements(tree, (element) => {
      const level = /^h([1-5])$/.exec(element.tagName)?.[1]
      if (level) element.tagName = `h${Number(level) + 1}`
    })
  }
}

function visitElements(node: Root | RootContent, visit: (element: Element) => void): void {
  if (node.type === 'element') visit(node)
  if ('children' in node) for (const child of node.children) visitElements(child, visit)
}

/**
 * The elements the reading surface decides for itself: the two that carry its
 * outbound-request policy, and bold, which Streamdown draws as a styled span
 * where an article means the element. Cast because Streamdown's `Components`
 * also carries a catch-all index signature for custom tags, which no element
 * component written to its own props satisfies.
 */
const COMPONENTS = {
  strong: 'strong',
  a: ArticleLink,
  img: ArticleImage,
} as Components

/**
 * Every article link leaves for someone else's page, so it is marked as a
 * departure and opened without a handle back into this one. A destination
 * that is not plain http(s) is not followed at all: its words stay, the link
 * does not.
 */
function ArticleLink({ href, children }: ComponentProps<'a'>) {
  if (!isSafeDestination(href)) return <>{children}</>

  return (
    <a className="article-link" href={href} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  )
}

/**
 * A proxied article image. Only the server's own signed proxy route may become
 * a request; any other source renders as its alt text and asks nobody for
 * anything. The stable fallback for an image that cannot load — missing,
 * expired signature, publisher gone — is that same alt text in the image's
 * place, so a broken image never becomes a broken page.
 */
function ArticleImage({ src, alt = '' }: ComponentProps<'img'>) {
  const [failed, setFailed] = useState(false)

  if (typeof src !== 'string' || !src.startsWith(`${READER_IMAGE_PATH}?`)) return <>{alt}</>
  if (failed) return <span className="article-image-fallback">{alt || 'image unavailable'}</span>

  return (
    <img className="article-image" src={src} alt={alt} loading="lazy" decoding="async" onError={() => setFailed(true)} />
  )
}

function isSafeDestination(href: string | undefined): href is string {
  try {
    const url = new URL(href ?? '')
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}
