import type { Page } from '@playwright/test'
import { addFeed, claim, expect, goTo, test, type Installation } from './installation.js'

async function openPost(page: Page, installation: Installation) {
  await claim(page, installation.url)
  await addFeed(page, installation.feedUrl)
  await goTo(page, 'Digest')
  await page.getByRole('main').getByRole('link', { name: 'First light' }).first().click()
  await expect(page.getByRole('heading', { name: 'First light', level: 1 })).toBeVisible()
}

const failedLine = (page: Page) => page.getByRole('status').filter({ hasText: 'couldn’t be saved' })

test.describe('saving on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 } })

  test('turns Save to Saved at the tap, before the server answers', async ({ page, installation }) => {
    await openPost(page, installation)
    await page.route('**/api/library/*', () => {})

    await page.getByRole('button', { name: 'Save First light' }).click()

    await expect(page.getByRole('button', { name: 'Saved First light' })).toHaveAttribute('aria-pressed', 'true')
  })

  test('puts Save back and shows the failure until it is dismissed', async ({ page, installation }) => {
    await openPost(page, installation)
    await page.route('**/api/library/*', (route) => route.fulfill({ status: 503, json: {} }))

    await page.getByRole('button', { name: 'Save First light' }).click()

    await expect(failedLine(page)).toBeVisible()
    const box = await failedLine(page).boundingBox()
    expect(box?.height).toBeGreaterThan(10)
    await expect(page.getByRole('button', { name: 'Save First light' })).toHaveAttribute('aria-pressed', 'false')

    await page.getByRole('button', { name: 'Dismiss' }).click()
    await expect(failedLine(page)).toBeHidden()
  })

  test('shows a failure that arrives after the Reader was left', async ({ page, installation }) => {
    await openPost(page, installation)
    let answer = () => {}
    await page.route('**/api/library/*', async (route) => {
      await new Promise<void>((resolve) => {
        answer = resolve
      })
      await route.fulfill({ status: 503, json: {} })
    })

    await page.getByRole('button', { name: 'Save First light' }).click()
    await page.locator('.x-back').click()
    await expect(page.getByRole('heading', { level: 2, name: 'Today' })).toBeVisible()
    answer()

    await expect(failedLine(page)).toBeVisible()
  })

  test('keeps a failure in view when the page is scrolled', async ({ page, installation }) => {
    await openPost(page, installation)
    await page.setViewportSize({ width: 390, height: 300 })
    await page.route('**/api/library/*', (route) => route.fulfill({ status: 503, json: {} }))
    await page.getByRole('button', { name: 'Save First light' }).click()
    await expect(failedLine(page)).toBeVisible()

    await page.evaluate(() => window.scrollTo({ top: 400 }))

    await expect(failedLine(page)).toBeInViewport()
  })
})
