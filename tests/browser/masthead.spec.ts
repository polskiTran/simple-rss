import type { Page } from '@playwright/test'
import { expect, SETUP_SECRET, test, USER_PASSWORD, type Installation } from './installation.js'

async function claim(page: Page, installation: Installation): Promise<void> {
  await page.goto(installation.url)
  await page.getByLabel('setup secret').fill(SETUP_SECRET)
  await page.getByLabel('password', { exact: true }).fill(USER_PASSWORD)
  await page.getByLabel('confirm password').fill(USER_PASSWORD)
  await page.getByRole('button', { name: 'claim' }).click()
  await expect(page.getByRole('navigation', { name: 'Sections' })).toBeVisible()
}

async function inkLevels(page: Page, scope = '.masthead'): Promise<string[]> {
  return page.$$eval(`${scope} .wordmark-cell`, (cells) => cells.map((cell) => getComputedStyle(cell).backgroundColor))
}

async function hangTheDigest(page: Page): Promise<void> {
  await page.route('**/api/digest*', () => {})
}

test.describe('the masthead mark', () => {
  test.use({ viewport: { width: 1280, height: 800 } })

  test('leads back to the digest from a Feed Item', async ({ page, installation }) => {
    await claim(page, installation)
    await page.getByRole('link', { name: 'feeds' }).click()
    await page.getByRole('textbox', { name: 'add a feed by url' }).fill(installation.feedUrl)
    await page.keyboard.press('Enter')
    await expect(page.getByRole('heading', { name: 'Field Notes' })).toBeVisible()

    await page.getByRole('link', { name: 'simple' }).click()

    await expect(page).toHaveURL(`${installation.url}/digest`)
    await expect(page.getByRole('link', { name: 'digest' })).toHaveAttribute('aria-current', 'page')
  })

  test('glints across the tile on hover and settles back at its own levels', async ({ page, installation }) => {
    await claim(page, installation)
    const resting = await inkLevels(page)

    await page.getByRole('link', { name: 'simple' }).hover()

    await page.waitForTimeout(120)
    expect(await inkLevels(page)).not.toEqual(resting)

    await expect.poll(async () => inkLevels(page), { timeout: 2_000 }).toEqual(resting)
  })

  test('holds still for a User who asked for less motion', async ({ page, installation }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await claim(page, installation)
    const resting = await inkLevels(page)

    await page.getByRole('link', { name: 'simple' }).hover()
    await page.waitForTimeout(120)

    expect(await inkLevels(page)).toEqual(resting)
  })

  test('glints on the waiting line, and holds still in the masthead', async ({ page, installation }) => {
    await claim(page, installation)
    await hangTheDigest(page)
    await page.getByRole('link', { name: 'feeds' }).click()
    await page.getByRole('link', { name: 'digest' }).click()
    await expect(page.getByText('loading the digest')).toBeVisible()

    const mastheadAtRest = await inkLevels(page)
    const frames = new Set<string>()
    for (let sample = 0; sample < 8; sample++) {
      frames.add((await inkLevels(page, '.loading-note')).join())
      await page.waitForTimeout(150)
    }

    expect(frames.size).toBeGreaterThan(3)
    expect(await inkLevels(page)).toEqual(mastheadAtRest)
  })

  test('breathes rather than stops for a User who asked for less motion', async ({ page, installation }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await claim(page, installation)
    await hangTheDigest(page)
    await page.getByRole('link', { name: 'feeds' }).click()
    await page.getByRole('link', { name: 'digest' }).click()
    await expect(page.getByText('loading the digest')).toBeVisible()

    const cells = await inkLevels(page, '.loading-note')
    const opacities = new Set<string>()
    for (let sample = 0; sample < 6; sample++) {
      opacities.add(await page.$eval('.loading-note .wordmark-grid', (grid) => getComputedStyle(grid).opacity))
      await page.waitForTimeout(180)
    }

    expect(await inkLevels(page, '.loading-note')).toEqual(cells)
    expect(opacities.size).toBeGreaterThan(2)
  })

  test('is a mark rather than a way through until the installation is claimed', async ({ page, installation }) => {
    await page.goto(installation.url)
    await expect(page.getByLabel('setup secret')).toBeVisible()

    await expect(page.getByText('simple')).toBeVisible()
    await expect(page.getByRole('link', { name: 'simple' })).toHaveCount(0)
  })
})
