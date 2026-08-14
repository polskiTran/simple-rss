import type { Page } from '@playwright/test'
import {
  expect,
  expectNoHorizontalOverflow,
  USER_PASSWORD,
  SETUP_SECRET,
  test,
  type Installation,
} from './installation.js'

const LIGHT_PAPER = 'rgb(247, 247, 245)'
const DARK_PAPER = 'rgb(18, 17, 15)'

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

async function openDigest(page: Page, installation: Installation): Promise<void> {
  await subscribe(page, installation)
  await page.getByRole('link', { name: 'digest' }).click()
}

test.describe('the Digest presentation', () => {
  test.use({ viewport: { width: 1280, height: 800 } })

  test('counts today in its heading and leaves past days uncounted', async ({ page, installation }) => {
    await openDigest(page, installation)

    const heading = page.getByRole('heading', { name: 'today · 1 post' })
    await expect(heading).toBeVisible()
    await expect(heading).toHaveCSS('font-size', '12.5px')
    await expect(page.locator('.day-heading-count')).toHaveCSS('color', 'rgb(163, 162, 157)')
  })

  test('follows a dark device into the documented dark paper', async ({ page, installation }) => {
    await page.emulateMedia({ colorScheme: 'dark' })
    await openDigest(page, installation)

    await expect(page.locator('body')).toHaveCSS('background-color', DARK_PAPER)
    await expect(page.locator('.paper')).toHaveCSS('padding-top', '36px')
    await expect(page.locator('.daily-band-field')).toBeVisible()
    await expect(page.getByRole('heading', { name: 'today · 1 post' })).toBeVisible()
  })

  test('lets the User pin dark on a light device, surviving a reload', async ({ page, installation }) => {
    await page.emulateMedia({ colorScheme: 'light' })
    await subscribe(page, installation)
    await expect(page.locator('body')).toHaveCSS('background-color', LIGHT_PAPER)

    await page.getByRole('link', { name: 'settings' }).click()
    await page.getByRole('button', { name: 'dark' }).click()
    await expect(page.locator('body')).toHaveCSS('background-color', DARK_PAPER)
    await expect(page.locator('.paper')).toHaveCSS('padding-top', '36px')

    await page.reload()
    await expect(page.locator('body')).toHaveCSS('background-color', DARK_PAPER)

    await page.getByRole('link', { name: 'settings' }).click()
    await page.getByRole('button', { name: 'system' }).click()
    await expect(page.locator('body')).toHaveCSS('background-color', LIGHT_PAPER)
  })

  test('changing the installation timezone recasts the same stored instant', async ({ page, installation }) => {
    await openDigest(page, installation)
    await expect(page.getByText('07:15')).toBeVisible()

    await page.getByRole('link', { name: 'settings' }).click()
    await page.getByLabel('installation timezone').selectOption('Pacific/Midway')
    await page.getByRole('link', { name: 'digest' }).click()

    await expect(page.getByText('20:15')).toBeVisible()
    await expect(page.locator('main')).not.toContainText('07:15')
  })

  test('ends at fifty items with `older items`, and one press extends the day', async ({ page, installation }) => {
    await page.goto(installation.url)
    await page.getByLabel('setup secret').fill(SETUP_SECRET)
    await page.getByLabel('password', { exact: true }).fill(USER_PASSWORD)
    await page.getByLabel('confirm password').fill(USER_PASSWORD)
    await page.getByRole('button', { name: 'claim' }).click()
    await page.getByRole('link', { name: 'feeds' }).click()
    await page.getByRole('textbox', { name: 'search or add feeds' }).fill(installation.longFeedUrl)
    await page.keyboard.press('Enter')
    await expect(page.getByRole('heading', { name: 'Long Meadow' })).toBeVisible()
    await page.getByRole('link', { name: 'digest' }).click()

    await expect(page.locator('.content-item')).toHaveCount(50)
    const older = page.getByRole('button', { name: 'older items' })
    await expect(older).toBeVisible()

    await older.click()
    await expect(page.locator('.content-item')).toHaveCount(55)
    await expect(older).toBeHidden()
  })

  test('names a network loss plainly and recovers on try again', async ({ page, installation }) => {
    await subscribe(page, installation)

    await page.context().setOffline(true)
    await page.getByRole('link', { name: 'digest' }).click()
    await expect(page.getByText('the digest is out of reach — check the connection, then try again')).toBeVisible()

    await page.context().setOffline(false)
    await page.getByRole('button', { name: 'try again' }).click()
    await expect(page.getByRole('heading', { name: 'today · 1 post' })).toBeVisible()
  })
})

test.describe('the Digest inside the narrow paper', () => {
  test.use({ viewport: { width: 390, height: 760 } })

  test('keeps the counted structure with the band at its one height', async ({ page, installation }) => {
    await openDigest(page, installation)

    const heading = page.getByRole('heading', { name: 'today · 1 post' })
    await expect(heading).toBeVisible()
    await expect(heading).toHaveCSS('font-size', '12px')
    await expect(page.locator('.daily-band')).toHaveCSS('height', '114px')
    await expectNoHorizontalOverflow(page)
  })
})
