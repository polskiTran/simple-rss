import { defineConfig, devices } from '@playwright/test'

/**
 * Browser flows for the things only a browser can prove: that the session
 * cookie really is unreadable from script, that `SameSite=Strict` and the
 * Origin check together stop a foreign page, and that a real reload keeps the
 * Owner signed in.
 *
 * Separated from `pnpm test` because it needs a downloaded browser and the
 * built client. Everything that can be asserted at the HTTP boundary is
 * asserted there instead, where it runs in milliseconds.
 */
export default defineConfig({
  testDir: './tests/browser',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    ...devices['Desktop Chrome'],
    trace: 'retain-on-failure',
  },
})
