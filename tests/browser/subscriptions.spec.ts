import type { Page } from '@playwright/test'
import { expect, OWNER_PASSWORD, SETUP_SECRET, test, type Installation } from './installation.js'

async function subscribe(page: Page, installation: Installation): Promise<void> {
  await page.goto(installation.url)
  await page.getByLabel('setup secret').fill(SETUP_SECRET)
  await page.getByLabel('password', { exact: true }).fill(OWNER_PASSWORD)
  await page.getByLabel('confirm password').fill(OWNER_PASSWORD)
  await page.getByRole('button', { name: 'claim' }).click()
  await page.getByRole('link', { name: 'feeds' }).click()
  await page.getByRole('textbox', { name: 'exact RSS or Atom URL' }).fill(installation.feedUrl)
  await page.getByRole('button', { name: 'subscribe' }).click()
  await expect(page.getByRole('heading', { name: 'Field Notes' })).toBeVisible()
}

async function expectFeedAndDigest(page: Page, installation: Installation): Promise<void> {
  await subscribe(page, installation)
  await expect(page.getByText('publisher.example')).toBeVisible()
  const visibleCadenceDays = await page.locator('.cadence-day').evaluateAll(
    (days) => days.filter((day) => getComputedStyle(day).display !== 'none').length,
  )
  expect(visibleCadenceDays).toBe((page.viewportSize()?.width ?? 0) <= 640 ? 14 : 30)

  await page.getByRole('link', { name: 'digest' }).click()
  await expect(page.getByRole('heading', { name: 'today' })).toBeVisible()
  await expect(page.locator('.daily-band-field:visible')).toHaveCount(1)
  await expect(page.locator('.digest-view')).toHaveCSS(
    'padding-top',
    (page.viewportSize()?.width ?? 0) <= 640 ? '26px' : '34px',
  )
  await expect(page.getByRole('heading', { name: 'First light' })).toBeVisible()
  await expect(page.getByText('Field Notes')).toBeVisible()
  await expect(page.getByText('07:15')).toBeVisible()
  await expect(page.getByRole('button', { name: 'save First light' })).toBeDisabled()
  await expect(page.locator('main')).not.toContainText(/unread/i)
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
    await page.evaluate(() => window.innerWidth),
  )
}

test.describe('desktop Feed and Digest rendering', () => {
  test.use({ viewport: { width: 1280, height: 800 } })

  test('keeps the accepted 820px paper and complete content shape', async ({ page, installation }) => {
    await expectFeedAndDigest(page, installation)
    await expect(page.locator('.paper')).toHaveCSS('width', '820px')
  })
})

test.describe('phone Feed and Digest rendering', () => {
  test.use({ viewport: { width: 390, height: 760 } })

  test('keeps the same structure inside the narrow paper', async ({ page, installation }) => {
    await expectFeedAndDigest(page, installation)
    await expect(page.locator('.paper')).toHaveCSS('width', '390px')
    await expect(page.getByRole('navigation', { name: 'Sections' })).toBeVisible()
  })
})
