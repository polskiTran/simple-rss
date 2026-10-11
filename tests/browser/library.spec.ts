import type { Page } from '@playwright/test'
import {
  addFeed,
  expect,
  expectNoHorizontalOverflow,
  USER_PASSWORD,
  SETUP_SECRET,
  test,
  type Installation,
} from './installation.js'

async function section(page: Page, name: string): Promise<void> {
  await page.getByRole('link', { name, exact: true }).click()
}

async function subscribe(page: Page, installation: Installation): Promise<void> {
  await page.goto(installation.url)
  await page.getByLabel('Setup secret').fill(SETUP_SECRET)
  await page.getByLabel('Password', { exact: true }).fill(USER_PASSWORD)
  await page.getByLabel('Confirm password').fill(USER_PASSWORD)
  await page.getByRole('button', { name: 'Claim installation' }).click()
  await section(page, 'Feeds')
  await addFeed(page, installation.feedUrl)
  await expect(page.getByRole('heading', { name: 'Field Notes' })).toBeVisible()
}

test.describe('the Library', () => {
  test.use({ viewport: { width: 1280, height: 800 } })

  test('saves from the Digest, keeps it across a reload, and unsaves from the Feed', async ({ page, installation }) => {
    await subscribe(page, installation)
    await section(page, 'Digest')

    const toggle = page.getByRole('button', { name: 'Save First light' })
    await expect(toggle).toHaveAttribute('aria-pressed', 'false')
    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-pressed', 'true')

    await section(page, 'Saved')
    await expect(page.getByRole('heading', { name: 'First light' })).toBeVisible()
    await expect(page.locator('.item-meta')).toContainText('Field Notes')
    await expect(page.getByRole('button', { name: 'Save First light' })).toHaveAttribute('aria-pressed', 'true')

    await page.reload()
    await expect(page.getByRole('heading', { name: 'First light' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Save First light' })).toHaveAttribute('aria-pressed', 'true')

    await section(page, 'Feeds')
    await page.getByRole('link', { name: 'Field Notes', exact: true }).click()
    const feedToggle = page.getByRole('button', { name: 'Save First light' })
    await expect(feedToggle).toHaveAttribute('aria-pressed', 'true')
    await feedToggle.click()
    await expect(feedToggle).toHaveAttribute('aria-pressed', 'false')

    await section(page, 'Digest')
    await expect(page.getByRole('button', { name: 'Save First light' })).toHaveAttribute('aria-pressed', 'false')
    await section(page, 'Saved')
    await expect(page.getByText(/Nothing saved yet/)).toBeVisible()
  })

  test('unsaving in Saved leaves an undo line, and Undo keeps the save', async ({ page, installation }) => {
    await subscribe(page, installation)
    await section(page, 'Digest')
    await page.getByRole('button', { name: 'Save First light' }).click()
    await section(page, 'Saved')

    await page.getByRole('button', { name: 'Save First light' }).click()
    await expect(page.getByText('“First light” is no longer saved.')).toBeVisible()
    await page.getByRole('button', { name: 'Undo' }).click()
    await expect(page.getByRole('button', { name: 'Save First light' })).toHaveAttribute('aria-pressed', 'true')

    await page.reload()
    await expect(page.getByRole('heading', { name: 'First light' })).toBeVisible()
  })

  test('save is keyboard-operable and repeated saves stay one membership', async ({ page, installation }) => {
    await subscribe(page, installation)
    await section(page, 'Digest')

    const toggle = page.getByRole('button', { name: 'Save First light' })
    await toggle.focus()
    await page.keyboard.press('Enter')
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

    await section(page, 'Saved')
    await expect(page.getByRole('heading', { name: 'First light' })).toHaveCount(1)
  })

  test('opens the Feed a save names, until the save outlives its Subscription', async ({ page, installation }) => {
    await subscribe(page, installation)
    await section(page, 'Digest')
    await page.getByRole('button', { name: 'Save First light' }).click()
    await section(page, 'Saved')

    await page.locator('.item-meta').getByRole('link', { name: 'Field Notes' }).click()
    await expect(page).toHaveURL(/\/feeds\/\d+$/)
    await expect(page.locator('main').getByRole('link', { name: 'Back to Saved' })).toBeVisible()

    await page.getByRole('button', { name: 'Unsubscribe' }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Unsubscribe' }).click()
    await expect(page.getByRole('heading', { level: 1, name: /^Feeds/ })).toBeVisible()

    await section(page, 'Saved')
    await expect(page.getByText(/No longer subscribed/)).toBeVisible()
    await expect(page.locator('main').getByRole('link', { name: /Field Notes/ })).toHaveCount(0)
  })
})

test.describe('the Library at phone width', () => {
  test.use({ viewport: { width: 390, height: 760 } })

  test('keeps the item shape at the phone scale without horizontal overflow', async ({ page, installation }) => {
    await subscribe(page, installation)
    await section(page, 'Digest')
    await page.getByRole('link', { name: 'First light' }).click()
    await page.getByRole('button', { name: 'Save First light' }).click()
    await expect(page.getByRole('button', { name: 'Saved First light' })).toHaveAttribute('aria-pressed', 'true')
    await page.getByRole('link', { name: 'Back to Digest' }).click()

    await section(page, 'Saved')
    const title = page.getByRole('heading', { name: 'First light' })
    await expect(title).toBeVisible()
    await expect(title).toHaveCSS('font-size', '17px')
    await expect(page.locator('.item-meta').first()).toHaveCSS('font-size', '13px')
    await expectNoHorizontalOverflow(page)
  })
})
