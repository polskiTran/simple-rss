import { defineConfig } from 'oxlint'

const ignoredTooling = [
  '.agent/**',
  '.agents/**',
  '.claude/**',
  '.codex/**',
  '.continue/**',
  '.cursor/**',
  '.gemini/**',
  '.humanlayer/**',
  '.opencode/**',
  '.pi/**',
  '.playwright-mcp/**',
  '.roo/**',
  '.windsurf/**',
  'agent-traces/**',
  'tools/oxlint/anti-slop/**',
]

export default defineConfig({
  categories: {
    correctness: 'off',
  },
  ignorePatterns: ignoredTooling,
  jsPlugins: [{ name: 'anti-slop', specifier: './tools/oxlint/anti-slop/index.ts' }],
  rules: {
    // Conditional spreads keep exact optional properties immutable; mutation
    // after construction would add code without adding type evidence.
    'anti-slop/no-conditional-empty-object-spread': 'off',
    'anti-slop/no-chained-type-assertions': 'error',
    'anti-slop/no-known-value-widening': 'error',
    'anti-slop/no-module-mocking': 'error',
    'anti-slop/no-object-parameters': 'error',
    'anti-slop/no-reflect-apply': 'error',
    'anti-slop/no-reflect-get': 'error',
    'anti-slop/no-unknown-type-aliases': 'error',
    // `shape` remains useful when a test names an intentionally malformed value.
    'anti-slop/no-shape-in-symbol-names': 'off',
    'anti-slop/no-widen-then-assert': 'error',
  },
  overrides: [
    {
      files: ['src/**/*.ts', 'src/**/*.tsx'],
      rules: {
        'anti-slop/no-runtime-typeof': 'error',
        'anti-slop/no-unknown-parameters': 'error',
        'anti-slop/no-unknown-returns': 'error',
        'anti-slop/no-unsafe-dictionary-type': 'error',
        'anti-slop/require-safety-comment-for-type-assertion': 'error',
      },
    },
    // These modules own heterogeneous XML values. They accept `unknown`, reduce
    // it through record/array/text helpers, and expose only parsed domain values.
    {
      files: [
        'src/server/ingestion/feed-document.ts',
        'src/server/ingestion/xml.ts',
        'src/server/subscriptions/opml.ts',
      ],
      rules: {
        'anti-slop/no-runtime-typeof': 'off',
        'anti-slop/no-unknown-parameters': 'off',
        'anti-slop/no-unknown-returns': 'off',
        'anti-slop/no-unsafe-dictionary-type': 'off',
      },
    },
    // These adapters validate values supplied by JavaScript or third-party APIs
    // at the point where those values enter owned code.
    {
      files: ['src/client/components/article-markdown.tsx', 'src/client/views/settings/timezone-choice.tsx'],
      rules: {
        'anti-slop/no-runtime-typeof': 'off',
      },
    },
    {
      files: ['src/client/routing.ts'],
      rules: {
        'anti-slop/no-unknown-parameters': 'off',
      },
    },
    {
      files: ['src/server/logger.ts'],
      rules: {
        'anti-slop/no-runtime-typeof': 'off',
        'anti-slop/no-unknown-parameters': 'off',
      },
    },
  ],
})
