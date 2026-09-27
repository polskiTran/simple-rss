import { createMathPlugin } from '@streamdown/math'
import type { Element, Root, RootContent } from 'hast'
import 'katex/dist/katex.min.css'
import { type ComponentProps, useState } from 'react'
import { Streamdown, type Components, type PluginConfig, defaultRehypePlugins } from 'streamdown'
import { READER_IMAGE_PATH } from '../../shared/api.js'
import { articleCode } from './article-code.js'

export function ArticleMarkdown({ markdown }: { readonly markdown: string }) {
  return (
    <Streamdown
      className="article-body"
      mode="static"
      plugins={PLUGINS}
      rehypePlugins={REHYPE_PLUGINS}
      components={COMPONENTS}
      controls={false}
    >
      {markdown}
    </Streamdown>
  )
}

const PLUGINS: PluginConfig = {
  code: articleCode,
  math: createMathPlugin({ singleDollarTextMath: false }),
}

const { raw, ...keptRehypePlugins } = defaultRehypePlugins
const REHYPE_PLUGINS = [...Object.values(keptRehypePlugins), shiftHeadings]

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

// Prose blocks render as plain elements, styled by the stylesheet's
// `.article-body` rules rather than Streamdown's utility classes. Code blocks
// stay Streamdown's, for their highlighting.
// SAFETY: Streamdown calls these overrides with the intrinsic element props
// named by each key; its public `Components` type erases that key-to-props link.
const COMPONENTS = {
  strong: 'strong',
  h2: 'h2',
  h3: 'h3',
  h4: 'h4',
  h5: 'h5',
  h6: 'h6',
  ul: 'ul',
  ol: 'ol',
  li: 'li',
  blockquote: 'blockquote',
  hr: 'hr',
  table: ArticleTable,
  thead: 'thead',
  tbody: 'tbody',
  tr: 'tr',
  th: 'th',
  td: 'td',
  a: ArticleLink,
  img: ArticleImage,
} as Components

/** A table scrolls sideways inside the column rather than widening it. */
function ArticleTable({ children }: ComponentProps<'table'>) {
  return (
    <div className="article-table">
      <table>{children}</table>
    </div>
  )
}

function ArticleLink({ href, children }: ComponentProps<'a'>) {
  if (!isSafeDestination(href)) return <>{children}</>

  return (
    <a className="article-link" href={href} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  )
}

function ArticleImage({ src, alt = '' }: ComponentProps<'img'>) {
  const [failed, setFailed] = useState(false)

  if (typeof src !== 'string' || !src.startsWith(`${READER_IMAGE_PATH}?`)) return <>{alt}</>
  if (failed) return <span className="article-image-fallback">{alt || 'image unavailable'}</span>

  return (
    <img
      className="article-image"
      src={src}
      alt={alt}
      loading="lazy"
      decoding="async"
      onError={() => setFailed(true)}
    />
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
