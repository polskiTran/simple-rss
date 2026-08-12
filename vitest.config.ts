import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { clientAliases } from './vite.config.js'

/**
 * Two projects, one command. Server tests run on Node against real temporary
 * SQLite databases; client tests run in jsdom. Container smoke tests live in
 * `vitest.smoke.config.ts` because they need a Docker daemon.
 */
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'server',
          environment: 'node',
          include: ['tests/server/**/*.test.ts'],
        },
      },
      {
        plugins: [react()],
        resolve: { alias: clientAliases },
        test: {
          name: 'client',
          environment: 'jsdom',
          include: ['tests/client/**/*.test.{ts,tsx}'],
          setupFiles: ['tests/client/setup.ts'],
        },
      },
    ],
  },
})
