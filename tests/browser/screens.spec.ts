import { addFeed, claim, expect, goTo, test, USER_PASSWORD } from './installation.js'

test.describe('the screens and the top bar', () => {
  test.use({ viewport: { width: 1280, height: 800 } })

  test('the top bar goes to a Feed and the Feed opens a Reader', async ({ page, installation }) => {
    await claim(page, installation.url)
    await addFeed(page, installation.feedUrl)
    await goTo(page, 'Digest')

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
    await addFeed(page, installation.feedUrl)
    await goTo(page, 'Digest')

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

  test('signing out leads to its own sign-in screen, which refuses a wrong password', async ({
    page,
    installation,
  }) => {
    await claim(page, installation.url)

    await goTo(page, 'Settings')
    await page.getByRole('button', { name: 'Sign out' }).click()
    const form = page.getByRole('form', { name: 'Sign in' })
    await expect(form.getByLabel('Password', { exact: true })).toBeFocused()
    await page.keyboard.insertText('not the password')
    await form.getByRole('button', { name: 'Sign in' }).click()
    await expect(form.getByText('That password isn’t right. Passwords are case-sensitive.')).toBeVisible()

    await form.getByLabel('Password', { exact: true }).fill(USER_PASSWORD)
    await form.getByRole('button', { name: 'Sign in' }).click()
    await expect(page.getByRole('navigation', { name: 'Places' })).toBeVisible()
  })

  test('the empty Digest leads to Add a Feed, and the Feed screen renames and unsubscribes it', async ({
    page,
    installation,
  }) => {
    await claim(page, installation.url)
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

  test('the Library lists saved Feed Items, and / focuses the search line', async ({ page, installation }) => {
    await claim(page, installation.url)
    await addFeed(page, installation.feedUrl)
    await goTo(page, 'Digest')
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
  })
})
