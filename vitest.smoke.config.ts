import { defineConfig } from 'vitest/config'

// Excluded from `pnpm test`: needs a Docker daemon and a full image build.
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
