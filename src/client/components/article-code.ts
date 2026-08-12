import type { BundledLanguage } from 'shiki'
import type { HighlighterCore } from 'shiki/core'
import type { CodeHighlighterPlugin, ThemeInput } from 'streamdown'

/**
 * Shiki's full bundle registers 200+ grammars up front; naming a handful here
 * keeps the rest out of the build, and a grammar loads only when a fenced
 * block asks for it.
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

// Low-contrast on both sides so code reads as part of the paper. Names only;
// the highlighter registers the theme bodies itself and resolves by name.
const THEMES: [ThemeInput, ThemeInput] = ['vitesse-light', 'vitesse-dark']

function grammarFor(language: string): Grammar | undefined {
  const name = language.trim().toLowerCase()
  if (name in GRAMMARS) return name as Grammar
  return ALIASES[name]
}

// One highlighter per page, one load per grammar, however many blocks ask.
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
    // JavaScript engine, not Oniguruma: no WebAssembly to fetch, and
    // `forgiving` keeps an uncompilable grammar from failing the block.
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

  // Always asynchronous: first paint is the unhighlighted code, colour arrives
  // with the grammar. Unsupported languages keep the first paint.
  highlight({ code, language }, callback) {
    const grammar = grammarFor(language)
    if (!grammar || !callback) return null

    void ready(grammar)
      .then((highlighter) => {
        // Both themes at once: tokens carry the light colour plus a
        // `--shiki-dark`, the shape the renderer's `dark:` classes read.
        callback(highlighter.codeToTokens(code, { lang: grammar, themes: { light: THEMES[0], dark: THEMES[1] } }))
      })
      .catch(() => {
        // Highlighting is decoration; the block already reads without it.
      })
    return null
  },
}
