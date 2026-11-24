import type { Page } from '@playwright/test'
import { addFeed, expect, SETUP_SECRET, test, USER_PASSWORD } from './installation.js'

async function claim(page: Page, url: string) {
  await page.goto(url)
  await page.getByLabel('Setup secret').fill(SETUP_SECRET)
  await page.getByLabel('Password', { exact: true }).fill(USER_PASSWORD)
  await page.getByLabel('Confirm password').fill(USER_PASSWORD)
  await page.getByRole('button', { name: 'Claim installation' }).click()
}

async function chooseExperimental(page: Page) {
  await page.getByRole('link', { name: 'Settings', exact: true }).click()
  await page.getByRole('button', { name: 'Experimental' }).click()
}

test.describe('the experimental interface', () => {
  test.use({ viewport: { width: 1280, height: 800 } })

  test('turned on in Settings, the top bar goes to a Feed and the Feed opens a Reader', async ({
    page,
    installation,
  }) => {
    await claim(page, installation.url)
    await page.getByRole('link', { name: 'Feeds', exact: true }).click()
    await addFeed(page, installation.feedUrl)
    await chooseExperimental(page)

    const places = page.getByRole('navigation', { name: 'Places' })
    await places.getByRole('link', { name: 'Feeds' }).click()
    await page.getByRole('main').getByRole('link', { name: 'Field Notes' }).click()
    await expect(page.getByRole('heading', { level: 1, name: 'Field Notes' })).toBeVisible()

    await page.getByRole('link', { name: 'First light' }).click()
    await expect(page.getByRole('heading', { level: 1, name: 'First light' })).toBeVisible()
    await expect(page).toHaveURL(/\/reader\/\d+$/)
  })

  test('search groups Feed Items under their Feed, and narrows to one Feed', async ({ page, installation }) => {
    await claim(page, installation.url)
    await page.getByRole('link', { name: 'Feeds', exact: true }).click()
    await addFeed(page, installation.feedUrl)
    await chooseExperimental(page)

    await page.getByRole('search').getByRole('searchbox').fill('light')
    await page.keyboard.press('Enter')
    const group = page.getByRole('region', { name: 'Field Notes' })
    await expect(group.getByRole('link', { name: 'First light' })).toBeVisible()

    await group.getByRole('button', { name: 'Search only here' }).click()
    await expect(page).toHaveURL(/[?&]feed=\d+/)
    await expect(
      page.getByRole('group', { name: 'Search in' }).getByRole('button', { name: 'Field Notes' }),
    ).toHaveAttribute('aria-pressed', 'true')
    await expect(
      page.getByRole('region', { name: 'Field Notes' }).getByRole('link', { name: 'First light' }),
    ).toBeVisible()
  })

  test('the empty Digest leads to Add a Feed, and the Feed screen renames and unsubscribes it', async ({
    page,
    installation,
  }) => {
    await claim(page, installation.url)
    await chooseExperimental(page)
    await page.getByRole('navigation', { name: 'Places' }).getByRole('link', { name: 'Digest' }).click()

    await page.getByRole('main').getByRole('link', { name: 'Add a Feed' }).click()
    await expect(page.getByLabel('Site or Feed address')).toBeFocused()
    await page.keyboard.insertText(installation.feedUrl)
    await page.getByRole('button', { name: 'Subscribe to Field Notes' }).click()
    await expect(page.getByRole('heading', { level: 1, name: 'Field Notes' })).toBeVisible()

    await page.getByRole('button', { name: 'Edit name and description' }).click()
    await expect(page.getByRole('textbox', { name: 'Name' })).toBeFocused()
    await page.keyboard.insertText('Morning Notes')
    await page.getByRole('button', { name: 'Save changes' }).click()
    await expect(page.getByRole('heading', { level: 1, name: 'Morning Notes' })).toBeVisible()

    await page.getByRole('button', { name: 'Unsubscribe', exact: true }).click()
    await page.getByRole('button', { name: 'Unsubscribe from Morning Notes' }).click()
    await expect(page.getByText('No Feeds yet.')).toBeVisible()
  })

  test('the Library lists saved Feed Items, and Settings switches back to v2', async ({ page, installation }) => {
    await claim(page, installation.url)
    await page.getByRole('link', { name: 'Feeds', exact: true }).click()
    await addFeed(page, installation.feedUrl)
    await chooseExperimental(page)
    const places = page.getByRole('navigation', { name: 'Places' })
    await places.getByRole('link', { name: 'Feeds' }).click()
    await page.getByRole('main').getByRole('link', { name: 'Field Notes' }).click()

    await page.getByRole('link', { name: 'First light' }).hover()
    await page.getByRole('button', { name: 'Save First light' }).click()
    await expect(page.getByRole('button', { name: 'Saved First light' })).toBeVisible()
    await places.getByRole('link', { name: 'Library' }).click()
    await expect(page.getByRole('heading', { level: 1, name: 'Library' })).toBeAttached()
    await expect(page.getByText('1 saved Feed Item')).toBeVisible()
    await expect(page.getByRole('link', { name: 'First light' })).toBeVisible()

    await page.keyboard.press('/')
    await expect(page.getByRole('search').getByRole('searchbox')).toBeFocused()
    await page.getByRole('link', { name: 'Settings', exact: true }).click()
    await page.getByRole('button', { name: 'v2' }).click()
    await expect(page.getByRole('navigation', { name: 'Places' })).toHaveCount(0)
  })
})
