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

/** The day `count` days before today, in the suite's pinned UTC. */
function daysAgo(count: number): string {
  return new Date(Date.now() - count * 86_400_000).toISOString().slice(0, 10)
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

  test('pages whole days up to fifty items, and Show more goes on from the next day', async ({
    page,
    installation,
  }) => {
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

test.describe('the Digest by item and by feed', () => {
  test.use({ viewport: { width: 1280, height: 800 } })

  test('starts from a day in the address, and goes back to today', async ({ page, installation }) => {
    await openDigest(page, installation)
    await expect(page.getByRole('heading', { name: TODAY_ONE })).toBeVisible()

    await page.goto(`${installation.url}/digest?from=${daysAgo(1)}`)
    await expect(page.getByText('Nothing on or before this day.')).toBeVisible()

    await page.getByRole('button', { name: 'Back to today' }).click()
    await expect(page.getByRole('heading', { name: TODAY_ONE })).toBeVisible()
    await expect(page).toHaveURL(/\/digest$/)
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

  test('reads from a picked date, and by feed, without overflowing the screen', async ({ page, installation }) => {
    await subscribe(page, installation)
    await page.getByRole('button', { name: 'Add feed' }).click()
    await page.getByRole('textbox', { name: 'URL' }).fill(installation.longFeedUrl)
    await page.getByRole('button', { name: 'Subscribe' }).click()
    await expect(page.getByRole('heading', { name: 'Long Meadow' })).toBeVisible()
    await page.getByRole('link', { name: 'Digest', exact: true }).click()

    await expect(page.getByRole('heading', { name: 'Today 2' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Long Meadow 1' })).toBeVisible()
    await expect(page.locator('.digest-calendar')).toBeHidden()
    await expectNoHorizontalOverflow(page)

    await page.getByLabel('Start from a day').fill(daysAgo(1))
    await expect(page).toHaveURL(new RegExp(`\\?from=${daysAgo(1)}$`))
    await expect(page.getByRole('button', { name: 'Back to today' })).toBeVisible()
    await expectNoHorizontalOverflow(page)

    await page.getByRole('button', { name: 'By feed' }).click()
    await expect(page.getByRole('region', { name: 'Field Notes' })).toBeVisible()
    await expectNoHorizontalOverflow(page)
  })
})
