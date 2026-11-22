import { defineConfig } from 'vitest/config'

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
