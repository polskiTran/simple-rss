import type { Page } from '@playwright/test'
import { expect, SETUP_SECRET, test, USER_PASSWORD, type Installation } from './installation.js'

async function claim(page: Page, installation: Installation): Promise<void> {
  await page.goto(installation.url)
  await page.getByLabel('Setup secret').fill(SETUP_SECRET)
  await page.getByLabel('Password', { exact: true }).fill(USER_PASSWORD)
  await page.getByLabel('Confirm password').fill(USER_PASSWORD)
  await page.getByRole('button', { name: 'Claim installation' }).click()
  await expect(page.getByRole('navigation', { name: 'Sections' })).toBeVisible()
}

/** The glint lifts each cell's ink through `filter`; at rest every cell has none. */
async function glintFrame(page: Page, scope = '.chrome'): Promise<string[]> {
  return page.$$eval(`${scope} .wordmark-cell`, (cells) => cells.map((cell) => getComputedStyle(cell).filter))
}

async function hangTheDigest(page: Page): Promise<void> {
  await page.route('**/api/digest**', () => {})
}

async function section(page: Page, name: string): Promise<void> {
  await page.getByRole('link', { name, exact: true }).click()
}

test.describe('the mark', () => {
  test.use({ viewport: { width: 1280, height: 800 } })

  test('leads back to the digest from a Feed', async ({ page, installation }) => {
    await claim(page, installation)
    await section(page, 'Feeds')
    await page.getByRole('button', { name: 'Add feed' }).click()
    await page.getByRole('textbox', { name: 'URL' }).fill(installation.feedUrl)
    await page.keyboard.press('Enter')
    await page.getByRole('link', { name: 'Field Notes', exact: true }).click()

    await page.getByRole('link', { name: 'simple' }).click()

    await expect(page).toHaveURL(`${installation.url}/digest`)
    await expect(page.getByRole('link', { name: 'Digest', exact: true })).toHaveAttribute('aria-current', 'page')
  })

  test('glints across the tile on hover and settles back at rest', async ({ page, installation }) => {
    await claim(page, installation)
    const resting = await glintFrame(page)

    await page.getByRole('link', { name: 'simple' }).hover()

    await page.waitForTimeout(120)
    expect(await glintFrame(page)).not.toEqual(resting)

    await expect.poll(async () => glintFrame(page), { timeout: 2_000 }).toEqual(resting)
  })

  test('holds still for a User who asked for less motion', async ({ page, installation }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await claim(page, installation)
    const resting = await glintFrame(page)

    await page.getByRole('link', { name: 'simple' }).hover()
    await page.waitForTimeout(120)

    expect(await glintFrame(page)).toEqual(resting)
  })

  test('glints on the waiting line, and holds still in the chrome', async ({ page, installation }) => {
    await claim(page, installation)
    await hangTheDigest(page)
    await section(page, 'Feeds')
    await section(page, 'Digest')
    await expect(page.getByText('Loading the digest')).toBeVisible()

    const chromeAtRest = await glintFrame(page)
    const frames = new Set<string>()
    for (let sample = 0; sample < 8; sample++) {
      frames.add((await glintFrame(page, '.loading-note')).join())
      await page.waitForTimeout(150)
    }

    expect(frames.size).toBeGreaterThan(3)
    expect(await glintFrame(page)).toEqual(chromeAtRest)
  })

  test('breathes rather than stops for a User who asked for less motion', async ({ page, installation }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await claim(page, installation)
    await hangTheDigest(page)
    await section(page, 'Feeds')
    await section(page, 'Digest')
    await expect(page.getByText('Loading the digest')).toBeVisible()

    const cells = await glintFrame(page, '.loading-note')
    const opacities = new Set<string>()
    for (let sample = 0; sample < 6; sample++) {
      opacities.add(await page.$eval('.loading-note .wordmark-grid', (grid) => getComputedStyle(grid).opacity))
      await page.waitForTimeout(180)
    }

    expect(await glintFrame(page, '.loading-note')).toEqual(cells)
    expect(opacities.size).toBeGreaterThan(2)
  })

  test('is a mark rather than a way through until the installation is claimed', async ({ page, installation }) => {
    await page.goto(installation.url)
    await expect(page.getByLabel('Setup secret')).toBeVisible()

    await expect(page.getByText('simple', { exact: true })).toBeVisible()
    await expect(page.getByRole('link', { name: 'simple' })).toHaveCount(0)
  })
})
