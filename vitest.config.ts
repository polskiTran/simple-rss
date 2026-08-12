import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { clientAliases } from './vite.config.js'

// Container smoke tests live in vitest.smoke.config.ts: they need a Docker daemon.
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
