import type { Page } from '@playwright/test'
import { expect, USER_PASSWORD, SETUP_SECRET, test, type Installation } from './installation.js'

/** Claims the installation, subscribes to both fixture Feeds, opens the Digest. */
async function openDigest(page: Page, installation: Installation): Promise<void> {
  await page.goto(installation.url)
  await page.getByLabel('setup secret').fill(SETUP_SECRET)
  await page.getByLabel('password', { exact: true }).fill(USER_PASSWORD)
  await page.getByLabel('confirm password').fill(USER_PASSWORD)
  await page.getByRole('button', { name: 'claim' }).click()
  await page.getByRole('link', { name: 'feeds' }).click()
  const control = page.getByRole('textbox', { name: 'search or add feeds' })
  await control.fill(installation.feedUrl)
  await page.keyboard.press('Enter')
  await expect(page.getByRole('heading', { name: 'Field Notes' })).toBeVisible()
  await control.fill(installation.brokenArticleFeedUrl)
  await page.keyboard.press('Enter')
  await expect(page.getByRole('heading', { name: 'The Quiet Coast' })).toBeVisible()
  await page.getByRole('link', { name: 'digest' }).click()
  await expect(page.getByRole('heading', { name: 'today · 1 post' })).toBeVisible()
}

test.describe('searching the reading history', () => {
  test.use({ viewport: { width: 1280, height: 800 } })

  test('finds items by summary words, opens one by keyboard, and returns cleanly', async ({
    page,
    installation,
  }) => {
    await openDigest(page, installation)

    // "clear morning" appears only in First light's summary, never its title.
    const field = page.getByRole('searchbox', { name: 'search your reading' })
    await field.fill('clear morning')

    const results = page.getByRole('region', { name: 'search results' })
    await expect(results.getByRole('link', { name: 'First light' })).toBeVisible()
    // The result names its Feed, so similar titles stay distinguishable.
    await expect(results).toContainText('Field Notes')
    await expect(results).toContainText('today')
    // The Digest's own furniture has stepped aside while the line stands.
    await expect(page.getByRole('heading', { name: 'today · 1 post' })).not.toBeVisible()

    // The keyboard is enough: Tab reaches the match, Enter opens the Reader.
    await page.keyboard.press('Tab')
    await expect(results.getByRole('link', { name: 'First light' })).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(page.getByRole('heading', { name: 'First light', level: 1 })).toBeVisible()

    // Back from the Reader, the Digest is itself again.
    await page.getByRole('link', { name: '← digest' }).click()
    await expect(page.getByRole('heading', { name: 'today · 1 post' })).toBeVisible()
  })

  test('matches a Feed title and says plainly when nothing matches', async ({ page, installation }) => {
    await openDigest(page, installation)

    const field = page.getByRole('searchbox', { name: 'search your reading' })
    // A word from the Feed's title finds what the Feed published.
    await field.fill('quiet coast')
    const results = page.getByRole('region', { name: 'search results' })
    await expect(results.getByRole('link', { name: 'Slow water' })).toBeVisible()
    await expect(results.getByRole('link', { name: 'First light' })).not.toBeVisible()

    await field.fill('driftwood')
    await expect(page.getByText('nothing in your reading matches “driftwood”')).toBeVisible()

    // Clearing the line brings the Digest straight back.
    await field.clear()
    await expect(page.getByRole('heading', { name: 'today · 1 post' })).toBeVisible()
  })
})

test.describe('searching inside the narrow paper', () => {
  test.use({ viewport: { width: 390, height: 760 } })

  test('keeps the same search under the same four tabs', async ({ page, installation }) => {
    await openDigest(page, installation)

    const field = page.getByRole('searchbox', { name: 'search your reading' })
    await expect(field).toBeVisible()
    await field.fill('slow')
    await expect(
      page.getByRole('region', { name: 'search results' }).getByRole('link', { name: 'Slow water' }),
    ).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      await page.evaluate(() => window.innerWidth),
    )
  })
})
