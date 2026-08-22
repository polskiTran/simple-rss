import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

// Shared with vitest.config.ts so client tests run the same module graph as the bundle.
export const clientAliases = {
  // Streamdown imports rehype-raw whether or not the plugin is used, and
  // parse5 comes with it. See `src/client/no-raw-html.ts`.
  'rehype-raw': fileURLToPath(new URL('./src/client/no-raw-html.ts', import.meta.url)),
}

function articleRenderer(name: string): string | undefined {
  return name.startsWith('mermaid-') ? 'article-renderer' : undefined
}

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
        // Rename only — a manual chunk group would be preloaded by the entry, defeating the
        // Reader's lazy import. The default `mermaid-*` name comes from Streamdown's Mermaid
        // stub, which this build does not ship.
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
      //
      // Object targets, not strings: Vite turns a string into
      // `{ changeOrigin: true }`, which rewrites `Host` to the target while the
      // browser's `Origin` still names this port, and the server's same-origin
      // guard refuses every unsafe method. The browser's `Host` passes through.
      '^/api/': { target: 'http://127.0.0.1:8080', changeOrigin: false },
      '^/health(/|$)': { target: 'http://127.0.0.1:8080', changeOrigin: false },
    },
  },
})
