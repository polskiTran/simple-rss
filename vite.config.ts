import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

/**
 * The client is a plain static bundle. One Node process serves it next to
 * `/api`, so `dev` only needs to proxy the API across the two dev ports.
 */
export default defineConfig({
  root: fileURLToPath(new URL('./src/client', import.meta.url)),
  plugins: [react(), tailwindcss()],
  build: {
    outDir: fileURLToPath(new URL('./dist/client', import.meta.url)),
    emptyOutDir: true,
    sourcemap: true,
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
