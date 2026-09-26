import type { Page } from '@playwright/test'
import {
  expect,
  expectNoHorizontalOverflow,
  USER_PASSWORD,
  SETUP_SECRET,
  test,
  type Installation,
} from './installation.js'

async function subscribe(page: Page, installation: Installation): Promise<void> {
  await page.goto(installation.url)
  await page.getByLabel('Setup secret').fill(SETUP_SECRET)
  await page.getByLabel('Password', { exact: true }).fill(USER_PASSWORD)
  await page.getByLabel('Confirm password').fill(USER_PASSWORD)
  await page.getByRole('button', { name: 'Claim installation' }).click()
  await page.getByRole('link', { name: 'Feeds', exact: true }).click()
  await page.getByRole('button', { name: 'Add feed' }).click()
  await page.getByRole('textbox', { name: 'URL' }).fill(installation.feedUrl)
  // Pressed rather than submitted with Enter: on a phone the sheet must sit above the tab bar.
  await page.getByRole('button', { name: 'Subscribe' }).click()
  await expect(page.getByRole('heading', { name: 'Field Notes' })).toBeVisible()
}

function narrow(page: Page): boolean {
  return (page.viewportSize()?.width ?? 0) <= 640
}

async function expectFeedAndDigest(page: Page, installation: Installation): Promise<void> {
  await subscribe(page, installation)
  await expect(page.getByText('publisher.example')).toBeVisible()
  const visibleCadenceDays = await page
    .locator('.cadence-day')
    .evaluateAll((days) => days.filter((day) => getComputedStyle(day).display !== 'none').length)
  expect(visibleCadenceDays).toBe(narrow(page) ? 14 : 30)

  await page.getByRole('link', { name: 'Digest', exact: true }).click()
  await expect(page.getByRole('heading', { name: /^Today/ })).toBeVisible()
  const item = page.locator('main article.item', { hasText: 'First light' })
  await expect(item.getByRole('link', { name: 'Field Notes' })).toBeVisible()
  await expect(item.getByText('07:15')).toBeVisible()
  await expect(item.getByRole('button', { name: 'Save First light' })).toHaveAttribute('aria-pressed', 'false')
  await expect(page.locator('main')).not.toContainText(/unread/i)
  await expectNoHorizontalOverflow(page)
}

async function expectOpenFeed(page: Page): Promise<void> {
  await page.getByRole('link', { name: 'Field Notes' }).click()
  await expect(page.getByRole('group', { name: '26 weeks of Cadence for Field Notes' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Back to Feeds' })).toBeVisible()
  await expect(page.getByText('publisher.example')).toBeVisible()

  expect(await page.locator('.cadence-grid .cadence-cell').count()).toBeGreaterThanOrEqual(176)
  expect(await page.locator('.cadence-month').count()).toBeGreaterThanOrEqual(3)
  const offScreen = await page.locator('.cadence-grid .cadence-cell').evaluateAll(
    (cells) =>
      cells.filter((cell) => {
        const box = cell.getBoundingClientRect()
        return box.left < 0 || box.right > window.innerWidth
      }).length,
  )
  expect(offScreen).toBe(0)

  const day = page.locator('button.cadence-cell')
  await expect(day).toHaveCount(1)
  await day.press('Enter')
  expect(await page.evaluate(() => document.activeElement?.textContent)).toContain('First light')
  await expect(page.locator('main article.item').getByText('07:15')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Save First light' })).toHaveAttribute('aria-pressed', 'false')
  await expectNoHorizontalOverflow(page)

  const interval = page.getByRole('combobox', { name: 'Check every' })
  await expect(interval).toHaveValue('120')
  await interval.selectOption({ label: '6 hours' })
  await expect(page.getByText('Now checked every 6 hours.')).toBeVisible()
  await page.getByRole('button', { name: 'Refresh now' }).click()
  await expect(page.getByText('Checked a moment ago. Wait a little before retrying.')).toBeVisible()

  await page.getByRole('link', { name: 'Back to Feeds' }).click()
  await expect(page.getByRole('heading', { level: 1, name: /^Feeds/ })).toBeVisible()
}

async function openFeed(page: Page, title = 'Field Notes'): Promise<void> {
  await page.getByRole('link', { name: title }).click()
  await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible()
}

test.describe('desktop Feed and Digest rendering', () => {
  test.use({ viewport: { width: 1280, height: 800 } })

  test('lists the Feed with its Cadence and shows its item in the Digest', async ({ page, installation }) => {
    await expectFeedAndDigest(page, installation)
  })

  test('opens one Feed into its Cadence grid and manages it there', async ({ page, installation }) => {
    await subscribe(page, installation)
    await expectOpenFeed(page)
  })

  test('changes the reading source by keyboard and keeps the server choice when the Feed is reopened', async ({
    page,
    installation,
  }) => {
    await subscribe(page, installation)
    await openFeed(page)

    const original = page.getByRole('button', { name: 'Original webpage' })
    const feedContent = page.getByRole('button', { name: 'Feed content' })
    await expect(original).toHaveAttribute('aria-pressed', 'true')
    await original.focus()
    await page.keyboard.press('ArrowRight')
    await page.keyboard.press('Space')

    await expect(feedContent).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByText('Items now open with the feed content.')).toBeVisible()
    await page.getByRole('link', { name: 'Back to Feeds' }).click()
    await openFeed(page)
    await expect(page.getByRole('button', { name: 'Feed content' })).toHaveAttribute('aria-pressed', 'true')
  })

  test('sets a custom name and description in the Edit feed dialog, and clearing them restores the reported values', async ({
    page,
    installation,
  }) => {
    await subscribe(page, installation)
    await openFeed(page)
    await expect(page.locator('.feed-description')).toHaveText('Notes from the field.')
    await page.getByRole('button', { name: 'Edit' }).click()

    const dialog = page.getByRole('dialog', { name: 'Edit feed' })
    const name = dialog.getByRole('textbox', { name: 'Name' })
    const description = dialog.getByRole('textbox', { name: 'Description' })
    await expect(name).toHaveAttribute('placeholder', 'Field Notes')
    await expect(description).toHaveAttribute('placeholder', 'Notes from the field.')
    await expect(name).toHaveAttribute('maxlength', '512')
    await expect(description).toHaveAttribute('maxlength', '1024')
    await name.fill('Tech tabloid')
    await description.fill('read weekly')
    await dialog.getByRole('button', { name: 'Save changes' }).click()

    await expect(page.getByRole('heading', { level: 1, name: 'Tech tabloid' })).toBeVisible()
    await expect(page.locator('.feed-description')).toHaveText('read weekly')
    await page.getByRole('link', { name: 'Back to Feeds' }).click()
    await openFeed(page, 'Tech tabloid')

    await page.getByRole('button', { name: 'Edit' }).click()
    await expect(name).toHaveValue('Tech tabloid')
    await expect(description).toHaveValue('read weekly')
    await name.fill('')
    await description.fill('')
    await dialog.getByRole('button', { name: 'Save changes' }).click()
    await expect(page.getByRole('heading', { level: 1, name: 'Field Notes' })).toBeVisible()
    await expect(page.locator('.feed-description')).toHaveText('Notes from the field.')
  })

  test('asks before unsubscribing, then leaves for an empty Feeds list', async ({ page, installation }) => {
    await subscribe(page, installation)
    await openFeed(page)
    await page.getByRole('button', { name: 'Unsubscribe' }).click()

    const dialog = page.getByRole('dialog', { name: 'Unsubscribe from Field Notes?' })
    await expect(dialog.getByText('Its items leave your digest. Saved items stay in Saved.')).toBeVisible()
    await dialog.getByRole('button', { name: 'Unsubscribe' }).click()

    await expect(page).toHaveURL(/\/feeds$/)
    await expect(page.getByText(/^No feeds yet\./)).toBeVisible()
  })
})

test.describe('phone Feed and Digest rendering', () => {
  test.use({ viewport: { width: 390, height: 760 } })

  test('keeps the same structure on the phone screen, sections along the bottom', async ({ page, installation }) => {
    await expectFeedAndDigest(page, installation)
    await expect(page.getByRole('navigation', { name: 'Sections' })).toBeVisible()
  })

  test('keeps the whole Cadence grid selectable on the phone screen', async ({ page, installation }) => {
    await subscribe(page, installation)
    await expectOpenFeed(page)
  })
})
