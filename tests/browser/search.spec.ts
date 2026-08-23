import type { Page } from '@playwright/test'
import { claim, expect, expectNoHorizontalOverflow, subscribe, test, type Installation } from './installation.js'

async function openDigest(page: Page, installation: Installation): Promise<void> {
  await claim(page, installation)
  await subscribe(page, installation.feedUrl, 'Field Notes')
  await subscribe(page, installation.brokenArticleFeedUrl, 'The Quiet Coast')
  await page.getByRole('link', { name: 'digest' }).click()
  await expect(page.getByRole('heading', { name: 'today · 1 post' })).toBeVisible()
}

test.describe('searching the reading history', () => {
  test.use({ viewport: { width: 1280, height: 800 } })

  test('finds items by summary words, opens one by keyboard, and returns cleanly', async ({ page, installation }) => {
    await openDigest(page, installation)

    const field = page.getByRole('searchbox', { name: 'search your reading' })
    await field.fill('clear morning')

    const results = page.getByRole('region', { name: 'search results' })
    await expect(results.getByRole('link', { name: 'First light' })).toBeVisible()
    await expect(results).toContainText('Field Notes')
    await expect(results).toContainText('today')
    await expect(page.getByRole('heading', { name: 'today · 1 post' })).not.toBeVisible()

    await page.keyboard.press('Tab')
    await expect(results.getByRole('link', { name: 'First light' })).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(page.getByRole('heading', { name: 'First light', level: 1 })).toBeVisible()

    await page.getByRole('link', { name: '← digest' }).click()
    await expect(page.getByRole('heading', { name: 'today · 1 post' })).toBeVisible()
  })

  test('matches a Feed title and says plainly when nothing matches', async ({ page, installation }) => {
    await openDigest(page, installation)

    const field = page.getByRole('searchbox', { name: 'search your reading' })
    await field.fill('quiet coast')
    const results = page.getByRole('region', { name: 'search results' })
    await expect(results.getByRole('link', { name: 'Slow water' })).toBeVisible()
    await expect(results.getByRole('link', { name: 'First light' })).not.toBeVisible()

    await field.fill('driftwood')
    await expect(page.getByText('nothing in your reading matches “driftwood”')).toBeVisible()

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
    await expectNoHorizontalOverflow(page)
  })
})
