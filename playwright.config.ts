import { defineConfig, devices } from '@playwright/test'

// Only what a real browser can prove (cookie attributes, cross-origin behavior,
// reload); anything assertable at the HTTP boundary belongs in `pnpm test`.
export default defineConfig({
  testDir: './tests/browser',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    ...devices['Desktop Chrome'],
    trace: 'retain-on-failure',
    // Claiming seeds the installation timezone from the browser; pin it so the
    // Digest's calendar groups do not follow the machine running the suite.
    timezoneId: 'UTC',
  },
})
