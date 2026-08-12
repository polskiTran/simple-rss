import type { BundledLanguage } from 'shiki'
import type { HighlighterCore } from 'shiki/core'
import type { CodeHighlighterPlugin, ThemeInput } from 'streamdown'

/**
 * Shiki highlighting for the languages an article is likely to quote.
 *
 * Shiki's own bundle registers 200+ grammars and their alias table up front;
 * naming a handful here keeps every other one out of the build. Nothing below
 * is imported until an article actually carries a fenced block, and then only
 * the grammar that block asked for.
 */

const GRAMMARS = {
  bash: () => import('shiki/langs/bash.mjs'),
  css: () => import('shiki/langs/css.mjs'),
  diff: () => import('shiki/langs/diff.mjs'),
  go: () => import('shiki/langs/go.mjs'),
  html: () => import('shiki/langs/html.mjs'),
  java: () => import('shiki/langs/java.mjs'),
  javascript: () => import('shiki/langs/javascript.mjs'),
  json: () => import('shiki/langs/json.mjs'),
  markdown: () => import('shiki/langs/markdown.mjs'),
  python: () => import('shiki/langs/python.mjs'),
  rust: () => import('shiki/langs/rust.mjs'),
  sql: () => import('shiki/langs/sql.mjs'),
  tsx: () => import('shiki/langs/tsx.mjs'),
  typescript: () => import('shiki/langs/typescript.mjs'),
  yaml: () => import('shiki/langs/yaml.mjs'),
} as const

type Grammar = keyof typeof GRAMMARS

/** The fence labels publishers write for a grammar filed here under another name. */
const ALIASES: Readonly<Record<string, Grammar>> = {
  console: 'bash',
  golang: 'go',
  js: 'javascript',
  jsonc: 'json',
  jsx: 'tsx',
  md: 'markdown',
  mjs: 'javascript',
  py: 'python',
  rs: 'rust',
  sh: 'bash',
  shell: 'bash',
  ts: 'typescript',
  yml: 'yaml',
  zsh: 'bash',
}

/**
 * Warm and low-contrast on both sides, so highlighted code reads as part of
 * the paper rather than a terminal dropped onto it. Their names, not their
 * bodies: the highlighter registers both and resolves them by name.
 */
const THEMES: [ThemeInput, ThemeInput] = ['vitesse-light', 'vitesse-dark']

function grammarFor(language: string): Grammar | undefined {
  const name = language.trim().toLowerCase()
  if (name in GRAMMARS) return name as Grammar
  return ALIASES[name]
}

/** One highlighter for the page, and one load per grammar however many blocks want it. */
let core: Promise<HighlighterCore> | undefined
const loaded = new Map<Grammar, Promise<HighlighterCore>>()

async function createCore(): Promise<HighlighterCore> {
  const [{ createHighlighterCore }, { createJavaScriptRegexEngine }, light, dark] = await Promise.all([
    import('shiki/core'),
    import('shiki/engine/javascript'),
    import('shiki/themes/vitesse-light.mjs'),
    import('shiki/themes/vitesse-dark.mjs'),
  ])
  return createHighlighterCore({
    themes: [light.default, dark.default],
    langs: [],
    // The JavaScript engine, not Oniguruma: no WebAssembly to fetch, and
    // `forgiving` keeps a grammar it cannot compile from failing the block.
    engine: createJavaScriptRegexEngine({ forgiving: true }),
  })
}

function ready(grammar: Grammar): Promise<HighlighterCore> {
  const pending =
    loaded.get(grammar) ??
    (async () => {
      core ??= createCore()
      const highlighter = await core
      await highlighter.loadLanguage((await GRAMMARS[grammar]()).default)
      return highlighter
    })()
  loaded.set(grammar, pending)
  return pending
}

export const articleCode: CodeHighlighterPlugin = {
  name: 'shiki',
  type: 'code-highlighter',
  getThemes: () => THEMES,
  getSupportedLanguages: () => Object.keys(GRAMMARS) as BundledLanguage[],
  supportsLanguage: (language) => grammarFor(language) !== undefined,

  /**
   * Always asynchronous: the first paint is the code itself, unhighlighted,
   * and colour arrives when the grammar does. A block in a language this
   * reader does not carry simply keeps that first paint.
   */
  highlight({ code, language }, callback) {
    const grammar = grammarFor(language)
    if (!grammar || !callback) return null

    void ready(grammar)
      .then((highlighter) => {
        // Both themes at once: every token carries the light colour and a
        // `--shiki-dark` beside it, which is the shape the renderer's own
        // `dark:` classes read.
        callback(highlighter.codeToTokens(code, { lang: grammar, themes: { light: THEMES[0], dark: THEMES[1] } }))
      })
      .catch(() => {
        // Highlighting is decoration; the block already reads without it.
      })
    return null
  },
}
