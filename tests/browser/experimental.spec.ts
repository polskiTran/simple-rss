import { addFeed, expect, SETUP_SECRET, test, USER_PASSWORD } from './installation.js'

test.describe('the experimental interface', () => {
  test.use({ viewport: { width: 1280, height: 800 } })

  test('turned on in Settings, the bloom goes to a Feed and the Feed opens a Reader', async ({
    page,
    installation,
  }) => {
    await page.goto(installation.url)
    await page.getByLabel('Setup secret').fill(SETUP_SECRET)
    await page.getByLabel('Password', { exact: true }).fill(USER_PASSWORD)
    await page.getByLabel('Confirm password').fill(USER_PASSWORD)
    await page.getByRole('button', { name: 'Claim installation' }).click()
    await page.getByRole('link', { name: 'Feeds', exact: true }).click()
    await addFeed(page, installation.feedUrl)

    await page.getByRole('link', { name: 'Settings', exact: true }).click()
    await page.getByRole('button', { name: 'Experimental' }).click()

    await page.keyboard.press('.')
    const menu = page.getByRole('dialog', { name: 'Menu' })
    await menu.getByRole('link', { name: 'Field Notes' }).click()
    await expect(menu).toHaveCount(0)
    await expect(page.getByRole('heading', { level: 1, name: 'Field Notes' })).toBeVisible()

    await page.getByRole('link', { name: 'First light' }).click()
    await expect(page.getByRole('heading', { level: 1, name: 'First light' })).toBeVisible()
    await expect(page).toHaveURL(/\/reader\/\d+$/)
  })
})
