import { defineConfig } from 'vitest/config'

/**
 * Container smoke tests. Separated from `pnpm test` because they build a
 * Docker image and need a daemon; a single build/run cycle is far slower than
 * the whole in-process suite.
 */
export default defineConfig({
  test: {
    name: 'smoke',
    environment: 'node',
    include: ['tests/smoke/**/*.test.ts'],
    testTimeout: 600_000,
    hookTimeout: 600_000,
    fileParallelism: false,
  },
})
