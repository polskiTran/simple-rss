import { createMathPlugin } from '@streamdown/math'
import type { Element, Root, RootContent } from 'hast'
// Self-hosted with its fonts so math renders without a third-party request;
// loads with this module, so it is never fetched unless an article opens.
import 'katex/dist/katex.min.css'
import { type ComponentProps, useState } from 'react'
import { Streamdown, type Components, type PluginConfig, defaultRehypePlugins } from 'streamdown'
import { READER_IMAGE_PATH } from '../../shared/api.js'
import { articleCode } from './article-code.js'

/**
 * Raw HTML has no path through: the server escapes it and rehype-raw is left
 * out below. Links and images pass through the components at the bottom, so a
 * hostile article can change what the Reader says but never what it does.
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
  // Safe: the server escapes every literal `$` in article text, so an
  // unescaped one is always a delimiter it wrote.
  math: createMathPlugin({ singleDollarTextMath: true }),
}

/** Streamdown's defaults minus rehype-raw: this dialect has no raw-HTML path. */
const { raw, ...keptRehypePlugins } = defaultRehypePlugins
const REHYPE_PLUGINS = [...Object.values(keptRehypePlugins), shiftHeadings]

// The Feed Item title is the page's one h1, so every article heading moves a
// level down; rewriting the tree keeps Streamdown's own heading rendering.
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

// `a` and `img` carry the outbound-request policy; `strong` because Streamdown
// otherwise draws a styled span. Cast: `Components` has a catch-all index
// signature no element component written to its own props satisfies.
const COMPONENTS = {
  strong: 'strong',
  a: ArticleLink,
  img: ArticleImage,
} as Components

// Opens in a new tab with no opener handle. A non-http(s) destination is not
// followed at all: its words stay, the link does not.
function ArticleLink({ href, children }: ComponentProps<'a'>) {
  if (!isSafeDestination(href)) return <>{children}</>

  return (
    <a className="article-link" href={href} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  )
}

// Only the server's own signed proxy route may become a request; any other
// src, and any load failure, renders as the alt text in the image's place.
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
