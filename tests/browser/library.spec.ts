import type { Page } from '@playwright/test'
import {
  claim,
  expect,
  expectNoHorizontalOverflow,
  subscribe as subscribeThroughDialog,
  test,
  type Installation,
} from './installation.js'

const LIGHT_ACCENT = 'rgb(36, 56, 216)'
const QUIET_GREY = 'rgb(163, 162, 157)'

async function subscribe(page: Page, installation: Installation): Promise<void> {
  await claim(page, installation)
  await subscribeThroughDialog(page, installation.feedUrl, 'Field Notes')
}

test.describe('the Library', () => {
  test.use({ viewport: { width: 1280, height: 800 } })

  test('saves from the Digest, keeps it across contexts and a reload, and unsaves', async ({ page, installation }) => {
    await subscribe(page, installation)
    await page.getByRole('link', { name: 'digest' }).click()

    const toggle = page.getByRole('button', { name: 'save First light' })
    await expect(toggle).toHaveText('save')
    await expect(toggle).toHaveCSS('color', QUIET_GREY)
    await toggle.click()
    await expect(toggle).toHaveText('saved')
    await expect(toggle).toHaveCSS('color', LIGHT_ACCENT)

    await page.getByRole('link', { name: 'saved' }).click()
    await expect(page.getByRole('heading', { name: 'First light' })).toBeVisible()
    await expect(page.locator('.content-meta')).toContainText('Field Notes')
    await expect(page.getByRole('button', { name: 'save First light' })).toHaveText('saved')

    await page.reload()
    await expect(page.getByRole('heading', { name: 'First light' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'save First light' })).toHaveText('saved')

    await page.getByRole('link', { name: 'feeds' }).click()
    await page.getByRole('link', { name: 'Field Notes' }).click()
    const feedToggle = page.getByRole('button', { name: 'save First light' })
    await expect(feedToggle).toHaveText('saved')
    await feedToggle.click()
    await expect(feedToggle).toHaveText('save')

    await page.getByRole('link', { name: 'digest' }).click()
    await expect(page.getByRole('button', { name: 'save First light' })).toHaveText('save')
    await page.getByRole('link', { name: 'saved' }).click()
    await expect(page.getByText(/nothing saved yet/)).toBeVisible()
  })

  test('save is keyboard-operable and repeated saves stay one membership', async ({ page, installation }) => {
    await subscribe(page, installation)
    await page.getByRole('link', { name: 'digest' }).click()

    const toggle = page.getByRole('button', { name: 'save First light' })
    await toggle.focus()
    await page.keyboard.press('Enter')
    await expect(toggle).toHaveText('saved')
    await expect(toggle).toHaveAttribute('aria-pressed', 'true')

    const membership = await page.evaluate(async () => {
      const digest = await (await fetch('/api/digest', { credentials: 'same-origin' })).json()
      const feedItemId = digest.groups[0].items[0].feedItemId
      const response = await fetch(`/api/library/${feedItemId}`, {
        method: 'PUT',
        credentials: 'same-origin',
      })
      return response.json()
    })
    expect(membership.saved).toBe(true)

    await page.getByRole('link', { name: 'saved' }).click()
    await expect(page.getByRole('heading', { name: 'First light' })).toHaveCount(1)
  })

  test('opens the Feed a save names, until the save outlives its Subscription', async ({ page, installation }) => {
    await subscribe(page, installation)
    await page.getByRole('link', { name: 'digest' }).click()
    await page.getByRole('button', { name: 'save First light' }).click()
    await page.getByRole('link', { name: 'saved' }).click()

    await page.locator('.content-meta').getByRole('link', { name: 'Field Notes' }).click()
    await expect(page).toHaveURL(/\/feeds\/\d+$/)
    await expect(page.getByRole('link', { name: '← saved' })).toBeVisible()

    await page.getByRole('button', { name: 'unsubscribe' }).click()
    await page.getByRole('button', { name: 'confirm' }).click()
    await expect(page.getByRole('textbox', { name: 'search or add feeds' })).toBeVisible()

    await page.getByRole('link', { name: 'saved' }).click()
    await expect(page.getByText('Field Notes · no longer subscribed')).toBeVisible()
    await expect(page.getByRole('link', { name: /Field Notes/ })).toHaveCount(0)
  })
})

test.describe('the Library inside the narrow paper', () => {
  test.use({ viewport: { width: 390, height: 760 } })

  test('keeps the shared shape and spacing without horizontal overflow', async ({ page, installation }) => {
    await subscribe(page, installation)
    await page.getByRole('link', { name: 'digest' }).click()
    await page.getByRole('button', { name: 'save First light' }).click()
    await expect(page.getByRole('button', { name: 'save First light' })).toHaveText('saved')

    await page.getByRole('link', { name: 'saved' }).click()
    const title = page.getByRole('heading', { name: 'First light' })
    await expect(title).toBeVisible()
    await expect(title).toHaveCSS('font-size', '19px')
    await expect(page.locator('.content-meta')).toHaveCSS('font-size', '12px')
    await expectNoHorizontalOverflow(page)
  })
})
