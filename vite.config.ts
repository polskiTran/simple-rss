import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

export const clientAliases = {
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
    assetsInlineLimit: (file) => (/\.(woff2?|ttf|otf)$/.test(file) ? false : undefined),
    rollupOptions: {
      output: {
        chunkFileNames: (chunk) => `assets/${articleRenderer(chunk.name) ?? '[name]'}-[hash].js`,
        assetFileNames: (asset) => `assets/${articleRenderer(asset.names[0] ?? '') ?? '[name]'}-[hash][extname]`,
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      '^/api/': { target: 'http://127.0.0.1:8080', changeOrigin: false },
      '^/health(/|$)': { target: 'http://127.0.0.1:8080', changeOrigin: false },
    },
  },
})
