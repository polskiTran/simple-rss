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
    >
      {markdown}
    </Streamdown>
  )
}

const PLUGINS: PluginConfig = {
  code: articleCode,
  math: createMathPlugin({ singleDollarTextMath: true }),
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

const COMPONENTS = {
  strong: 'strong',
  a: ArticleLink,
  img: ArticleImage,
} as Components

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
