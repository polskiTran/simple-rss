import type { Page } from '@playwright/test'
import {
  expect,
  expectNoHorizontalOverflow,
  USER_PASSWORD,
  SETUP_SECRET,
  test,
  type Installation,
} from './installation.js'

const TODAY_ONE = 'Today 1'

async function claimAndSubscribe(page: Page, installation: Installation, feedUrl: string, title: string) {
  await page.goto(installation.url)
  await page.getByLabel('Setup secret').fill(SETUP_SECRET)
  await page.getByLabel('Password', { exact: true }).fill(USER_PASSWORD)
  await page.getByLabel('Confirm password').fill(USER_PASSWORD)
  await page.getByRole('button', { name: 'Claim installation' }).click()
  await page.getByRole('link', { name: 'Feeds', exact: true }).click()
  await page.getByRole('button', { name: 'Add feed' }).click()
  await page.getByRole('textbox', { name: 'URL' }).fill(feedUrl)
  await page.keyboard.press('Enter')
  await expect(page.getByRole('heading', { name: title })).toBeVisible()
}

async function subscribe(page: Page, installation: Installation): Promise<void> {
  await claimAndSubscribe(page, installation, installation.feedUrl, 'Field Notes')
}

async function openDigest(page: Page, installation: Installation): Promise<void> {
  await subscribe(page, installation)
  await page.getByRole('link', { name: 'Digest', exact: true }).click()
}

function groundColour(page: Page): Promise<string> {
  return page.evaluate(() => getComputedStyle(document.body).backgroundColor)
}

test.describe('the Digest presentation', () => {
  test.use({ viewport: { width: 1280, height: 800 } })

  test('counts today in its heading from the server', async ({ page, installation }) => {
    await openDigest(page, installation)

    await expect(page.getByRole('heading', { name: TODAY_ONE })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'First light' })).toBeVisible()
  })

  test('lets the User pin dark on a light device, surviving a reload', async ({ page, installation }) => {
    await page.emulateMedia({ colorScheme: 'light' })
    await subscribe(page, installation)
    const light = await groundColour(page)

    await page.getByRole('link', { name: 'Settings', exact: true }).click()
    await page.getByRole('button', { name: 'Dark' }).click()
    await expect(page.locator('html')).toHaveAttribute('data-appearance', 'dark')
    await expect(page.locator('html')).toHaveCSS('color-scheme', 'dark')
    const dark = await groundColour(page)
    expect(dark).not.toBe(light)

    await page.reload()
    await expect(page.locator('html')).toHaveAttribute('data-appearance', 'dark')
    expect(await groundColour(page)).toBe(dark)

    await page.getByRole('link', { name: 'Settings', exact: true }).click()
    await page.getByRole('button', { name: 'System' }).click()
    await expect(page.locator('html')).not.toHaveAttribute('data-appearance', /.*/)
    expect(await groundColour(page)).toBe(light)
  })

  test('follows a dark device when nothing is pinned', async ({ page, installation }) => {
    await page.emulateMedia({ colorScheme: 'light' })
    await openDigest(page, installation)
    const light = await groundColour(page)

    await page.emulateMedia({ colorScheme: 'dark' })
    await expect.poll(() => groundColour(page)).not.toBe(light)
    await expect(page.getByRole('heading', { name: TODAY_ONE })).toBeVisible()
  })

  test('changing the installation timezone recasts the same stored instant', async ({ page, installation }) => {
    await openDigest(page, installation)
    await expect(page.locator('main').getByText('07:15')).toBeVisible()

    await page.getByRole('link', { name: 'Settings', exact: true }).click()
    await page.getByRole('combobox', { name: 'Installation timezone' }).selectOption('Pacific/Midway')
    await page.getByRole('link', { name: 'Digest', exact: true }).click()

    await expect(page.locator('main').getByText('20:15')).toBeVisible()
    await expect(page.locator('main')).not.toContainText('07:15')
  })

  test('ends at fifty items with Show more, and one press extends the day', async ({ page, installation }) => {
    await claimAndSubscribe(page, installation, installation.longFeedUrl, 'Long Meadow')
    await page.getByRole('link', { name: 'Digest', exact: true }).click()

    await expect(page.locator('main article.item')).toHaveCount(50)
    const more = page.getByRole('button', { name: 'Show more' })
    await expect(more).toBeVisible()

    await more.click()
    await expect(page.locator('main article.item')).toHaveCount(55)
    await expect(more).toBeHidden()
  })

  test('comes back from an article to the same entry and place, announced', async ({ page, installation }) => {
    await claimAndSubscribe(page, installation, installation.longFeedUrl, 'Long Meadow')
    await page.getByRole('link', { name: 'Digest', exact: true }).click()
    const deep = page.getByRole('link', { name: 'Meadow note 30', exact: true })
    await deep.scrollIntoViewIfNeeded()
    const left = await page.evaluate(() => window.scrollY)
    expect(left).toBeGreaterThan(0)

    await deep.click()
    await expect(page.getByRole('heading', { level: 1, name: 'Meadow note 30' })).toBeFocused()
    await expect(page).toHaveTitle('Meadow note 30 — simple')
    const entries = await page.evaluate(() => history.length)
    await page.getByRole('link', { name: 'Back to Digest' }).click()

    await expect(page).toHaveURL(/\/digest$/)
    await expect(page).toHaveTitle('Digest — simple')
    await expect(page.getByRole('heading', { level: 1 })).toBeFocused()
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(left)
    expect(await page.evaluate(() => history.length)).toBe(entries)

    await page.goBack()
    await expect(page).not.toHaveURL(/\/reader\//)
  })

  test('names a network loss plainly and recovers on Retry', async ({ page, installation }) => {
    await subscribe(page, installation)

    await page.context().setOffline(true)
    await page.getByRole('link', { name: 'Digest', exact: true }).click()
    await expect(page.getByText('The digest can’t be reached. Check the connection, then try again.')).toBeVisible()

    await page.context().setOffline(false)
    await page.getByRole('button', { name: 'Retry' }).click()
    await expect(page.getByRole('heading', { name: TODAY_ONE })).toBeVisible()
  })
})

test.describe('the Digest by day and by feed', () => {
  test.use({ viewport: { width: 1280, height: 800 } })

  test('steps back a day and returns to today, keeping the day in the address', async ({ page, installation }) => {
    await openDigest(page, installation)
    await page.getByRole('button', { name: 'By day' }).click()

    await expect(page.getByRole('heading', { name: TODAY_ONE })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Next day' })).toBeDisabled()

    await page.getByRole('button', { name: 'Previous day' }).click()
    await expect(page.getByText('Nothing landed on this day.')).toBeVisible()
    await expect(page).toHaveURL(/\?by=day&day=\d{4}-\d{2}-\d{2}$/)

    await page.getByRole('button', { name: 'Today', exact: true }).click()
    await expect(page.getByRole('heading', { name: TODAY_ONE })).toBeVisible()
    await expect(page).toHaveURL(/\?by=day$/)
  })

  test('opens an article from a Feed’s card', async ({ page, installation }) => {
    await openDigest(page, installation)
    await page.getByRole('button', { name: 'By feed' }).click()

    const card = page.getByRole('region', { name: 'Field Notes' })
    await expect(card.getByText('07:15')).toBeVisible()
    await card.getByRole('link', { name: 'First light' }).click()

    await expect(page.getByRole('heading', { level: 1, name: 'First light' })).toBeVisible()
  })
})

test.describe('the Digest at phone width', () => {
  test.use({ viewport: { width: 390, height: 760 } })

  test('keeps the counted structure without overflowing the screen', async ({ page, installation }) => {
    await openDigest(page, installation)

    await expect(page.getByRole('heading', { name: TODAY_ONE })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Save First light' })).toBeVisible()
    await expectNoHorizontalOverflow(page)
  })

  test('reads by day, Feeds as chips, and by feed without overflowing the screen', async ({ page, installation }) => {
    await subscribe(page, installation)
    await page.getByRole('button', { name: 'Add feed' }).click()
    await page.getByRole('textbox', { name: 'URL' }).fill(installation.longFeedUrl)
    await page.getByRole('button', { name: 'Subscribe' }).click()
    await expect(page.getByRole('heading', { name: 'Long Meadow' })).toBeVisible()
    await page.getByRole('link', { name: 'Digest', exact: true }).click()

    await page.getByRole('button', { name: 'By day' }).click()
    await expect(page.getByRole('heading', { name: 'Today 56' })).toBeVisible()
    await expect(page.getByRole('group', { name: '26 weeks of Cadence for your digest' })).toBeVisible()
    await expect(page.getByRole('complementary', { name: 'Narrow by feed' })).toBeVisible()
    await expectNoHorizontalOverflow(page)

    await page.getByRole('button', { name: 'By feed' }).click()
    await expect(page.getByRole('region', { name: 'Field Notes' })).toBeVisible()
    await expectNoHorizontalOverflow(page)
  })
})
