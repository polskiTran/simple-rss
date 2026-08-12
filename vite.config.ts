import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

/**
 * Modules the client resolves somewhere other than where their name points.
 * Exported because `vitest.config.ts` gives the client tests the same ones —
 * a test that ran a different module graph than the bundle would be testing
 * the wrong software.
 */
export const clientAliases = {
  // Streamdown imports rehype-raw whether or not the plugin is used, and
  // parse5 comes with it. See `src/client/no-raw-html.ts`.
  'rehype-raw': fileURLToPath(new URL('./src/client/no-raw-html.ts', import.meta.url)),
}

/** `article-renderer` for the Reader's renderer chunk, nothing for the rest. */
function articleRenderer(name: string): string | undefined {
  return name.startsWith('mermaid-') ? 'article-renderer' : undefined
}

/**
 * The client is a plain static bundle. One Node process serves it next to
 * `/api`, so `dev` only needs to proxy the API across the two dev ports.
 */
export default defineConfig({
  root: fileURLToPath(new URL('./src/client', import.meta.url)),
  plugins: [react(), tailwindcss()],
  resolve: { alias: clientAliases },
  build: {
    outDir: fileURLToPath(new URL('./dist/client', import.meta.url)),
    emptyOutDir: true,
    sourcemap: true,
    rollupOptions: {
      output: {
        // Renaming only — grouping these modules by hand instead would make
        // the entry preload them, which is the opposite of what the Reader's
        // lazy import is for. Rollup names a chunk after one of the modules
        // that enter it, and for the Reader's renderer that is Streamdown's
        // lazy Mermaid stub: a build listing `mermaid-*.js` reads as a Mermaid
        // this installation does not ship, so it is named for what it is.
        chunkFileNames: (chunk) => `assets/${articleRenderer(chunk.name) ?? '[name]'}-[hash].js`,
        // The chunk's stylesheet — KaTeX's — is named from the same module.
        assetFileNames: (asset) => `assets/${articleRenderer(asset.names[0] ?? '') ?? '[name]'}-[hash][extname]`,
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      // Regex keys, not prefixes: a plain '/api' would also capture the
      // client's own `/api.ts` module and hand it to the backend.
      '^/api/': 'http://127.0.0.1:8080',
      '^/health(/|$)': 'http://127.0.0.1:8080',
    },
  },
})
