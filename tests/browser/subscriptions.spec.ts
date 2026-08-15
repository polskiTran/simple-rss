import type { Page } from '@playwright/test'
import {
  expect,
  expectNoHorizontalOverflow,
  USER_PASSWORD,
  SETUP_SECRET,
  test,
  type Installation,
} from './installation.js'

const DANGER_RED = 'rgb(176, 43, 39)'
const INK = 'rgb(18, 17, 15)'

async function subscribe(page: Page, installation: Installation): Promise<void> {
  await page.goto(installation.url)
  await page.getByLabel('setup secret').fill(SETUP_SECRET)
  await page.getByLabel('password', { exact: true }).fill(USER_PASSWORD)
  await page.getByLabel('confirm password').fill(USER_PASSWORD)
  await page.getByRole('button', { name: 'claim' }).click()
  await page.getByRole('link', { name: 'feeds' }).click()
  await page.getByRole('textbox', { name: 'search or add feeds' }).fill(installation.feedUrl)
  await page.keyboard.press('Enter')
  await expect(page.getByRole('heading', { name: 'Field Notes' })).toBeVisible()
}

async function expectFeedAndDigest(page: Page, installation: Installation): Promise<void> {
  await subscribe(page, installation)
  await expect(page.getByText('publisher.example')).toBeVisible()
  const visibleCadenceDays = await page
    .locator('.cadence-day')
    .evaluateAll((days) => days.filter((day) => getComputedStyle(day).display !== 'none').length)
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
  await expect(page.getByRole('button', { name: 'save First light' })).toHaveText('save')
  await expect(page.locator('main')).not.toContainText(/unread/i)
  await expectNoHorizontalOverflow(page)
}

async function expectOpenFeed(page: Page): Promise<void> {
  const narrow = (page.viewportSize()?.width ?? 0) <= 640

  await page.getByRole('link', { name: 'Field Notes' }).click()
  await expect(page.getByRole('group', { name: /26 weeks of publishing cadence for Field Notes/ })).toBeVisible()
  await expect(page.getByRole('link', { name: '← feeds' })).toBeVisible()
  await expect(page.getByText('publisher.example')).toBeVisible()

  await expect(page.locator('.cadence-cell').first()).toHaveCSS('width', narrow ? '9px' : '11px')
  expect(await page.locator('.cadence-cell').count()).toBeGreaterThanOrEqual(176)
  expect(await page.locator('.cadence-month').count()).toBeGreaterThanOrEqual(3)
  await expect(page.getByText(/1 post in 26 weeks/)).toBeVisible()

  const day = page.locator('button.cadence-cell')
  await expect(day).toHaveCount(1)
  await day.press('Enter')
  expect(await page.evaluate(() => document.activeElement?.textContent)).toContain('First light')
  await expect(page.getByText('today, 07:15')).toBeVisible()
  await expect(page.getByRole('button', { name: 'save First light' })).toHaveText('save')
  await expectNoHorizontalOverflow(page)

  await expect(page.getByRole('button', { name: 'check every 2 hours' })).toHaveAttribute('aria-pressed', 'true')
  await page.getByRole('button', { name: 'check every 6 hours' }).click()
  await expect(page.getByText('now checked every 6 hours')).toBeVisible()
  await page.getByRole('button', { name: 'refresh now' }).click()
  await expect(page.getByText('checked a moment ago — wait a little before retrying')).toBeVisible()

  await page.getByRole('link', { name: '← feeds' }).click()
  await expect(page.getByRole('textbox', { name: 'search or add feeds' })).toBeVisible()
}

test.describe('desktop Feed and Digest rendering', () => {
  test.use({ viewport: { width: 1280, height: 800 } })

  test('keeps the accepted 820px paper and complete content shape', async ({ page, installation }) => {
    await expectFeedAndDigest(page, installation)
    await expect(page.locator('.paper')).toHaveCSS('width', '820px')
  })

  test('opens one Feed into its cadence grid and manages it there', async ({ page, installation }) => {
    await subscribe(page, installation)
    await expectOpenFeed(page)
  })

  test('sets a custom title in the edit overlay, and clearing it restores the reported title', async ({
    page,
    installation,
  }) => {
    await subscribe(page, installation)
    await page.getByRole('link', { name: 'Field Notes' }).click()
    await page.getByRole('button', { name: 'edit' }).click()

    const title = page.getByRole('textbox', { name: 'title' })
    await expect(title).toHaveAttribute('placeholder', 'Field Notes')
    await title.fill('Tech tabloid')
    await page.getByRole('button', { name: 'save', exact: true }).click()

    await expect(page.locator('.feed-header-title')).toHaveText('Tech tabloid')
    await page.getByRole('link', { name: '← feeds' }).click()
    await page.getByRole('link', { name: 'Tech tabloid' }).click()

    await page.getByRole('button', { name: 'edit' }).click()
    await expect(title).toHaveValue('Tech tabloid')
    await title.fill('')
    await page.getByRole('button', { name: 'save', exact: true }).click()
    await expect(page.locator('.feed-header-title')).toHaveText('Field Notes')
  })

  test('colours the confirming word of the unsubscribe overlay, and only it', async ({ page, installation }) => {
    await subscribe(page, installation)
    await page.getByRole('link', { name: 'Field Notes' }).click()
    await page.getByRole('button', { name: 'unsubscribe' }).click()

    await expect(page.getByRole('button', { name: 'confirm' })).toHaveCSS('color', DANGER_RED)
    await expect(page.getByRole('button', { name: 'cancel' })).toHaveCSS('color', INK)
  })
})

test.describe('phone Feed and Digest rendering', () => {
  test.use({ viewport: { width: 390, height: 760 } })

  test('keeps the same structure inside the narrow paper', async ({ page, installation }) => {
    await expectFeedAndDigest(page, installation)
    const paper = await page.evaluate(() => ({
      width: document.querySelector('.paper')!.getBoundingClientRect().width,
      contentWidth: document.body.clientWidth,
    }))
    expect(paper.width).toBe(paper.contentWidth)
    await expect(page.getByRole('navigation', { name: 'Sections' })).toBeVisible()
  })

  test('keeps the whole cadence grid selectable inside the narrow paper', async ({ page, installation }) => {
    await subscribe(page, installation)
    await expectOpenFeed(page)
  })
})
