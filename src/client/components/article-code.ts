import { hasOwn } from '../../shared/record.js'
import type { HighlighterCore } from 'shiki/core'
import type { CodeHighlighterPlugin, ThemeInput } from 'streamdown'

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

function isGrammar(name: string): name is Grammar {
  return Object.hasOwn(GRAMMARS, name)
}

const SUPPORTED_LANGUAGES = Object.keys(GRAMMARS).filter(isGrammar)

const ALIASES = {
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
} as const satisfies Readonly<Record<string, Grammar>>

const THEMES: [light: ThemeInput, dark: ThemeInput] = ['vitesse-light', 'vitesse-dark']

function grammarFor(language: string): Grammar | undefined {
  const name = language.trim().toLowerCase()
  if (isGrammar(name)) return name
  return hasOwn(ALIASES, name) ? ALIASES[name] : undefined
}

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
  getSupportedLanguages: () => SUPPORTED_LANGUAGES,
  supportsLanguage: (language) => grammarFor(language) !== undefined,

  highlight({ code, language }, callback) {
    const grammar = grammarFor(language)
    if (!grammar || !callback) return null

    void ready(grammar)
      .then((highlighter) => {
        // Both themes at once: tokens carry the light colour plus a
        // `--shiki-dark`, the shape the renderer's `dark:` classes read.
        callback(highlighter.codeToTokens(code, { lang: grammar, themes: { light: THEMES[0], dark: THEMES[1] } }))
      })
      .catch(() => {})
    return null
  },
}
