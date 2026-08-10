import type { Page } from '@playwright/test'
import { expect, USER_PASSWORD, SETUP_SECRET, test, type Installation } from './installation.js'

const SESSION_COOKIE = 'simple_rss_session'

/** Claims the installation the way the User does on first visit. */
async function claim(page: Page, installation: Installation, password = USER_PASSWORD): Promise<void> {
  await page.goto(installation.url)
  await page.getByLabel('setup secret').fill(SETUP_SECRET)
  await page.getByLabel('password', { exact: true }).fill(password)
  await page.getByLabel('confirm password').fill(password)
  await page.getByRole('button', { name: 'claim' }).click()
  await expect(page.getByRole('navigation', { name: 'Sections' })).toBeVisible()
}

async function signIn(page: Page, installation: Installation, password = USER_PASSWORD): Promise<void> {
  await page.goto(installation.url)
  await page.getByLabel('password').fill(password)
  await page.getByRole('button', { name: 'sign in' }).click()
}


test.describe('claiming an installation in a browser', () => {
  test('takes the setup secret and lands the User in the reader', async ({ page, installation }) => {
    await page.goto(installation.url)

    await expect(page.getByRole('form', { name: 'Claim this installation' })).toBeVisible()
    await claim(page, installation)

    await expect(page.getByText('nothing yet — subscribe to a feed')).toBeVisible()
  })

  test('never offers setup again, even to a browser that has never been here', async ({
    browser,
    page,
    installation,
  }) => {
    await claim(page, installation)

    const stranger = await browser.newContext()
    const strangerPage = await stranger.newPage()
    await strangerPage.goto(installation.url)

    await expect(strangerPage.getByRole('form', { name: 'Sign in' })).toBeVisible()
    await expect(strangerPage.getByLabel('setup secret')).toHaveCount(0)
  })
})

test.describe('the session cookie', () => {
  test('is not readable by script on the page', async ({ page, installation }) => {
    await claim(page, installation)

    await expect.poll(() => page.evaluate(() => document.cookie)).not.toContain(SESSION_COOKIE)
  })

  test('is stored HttpOnly, Secure, and SameSite=Strict', async ({ page, installation }) => {
    await claim(page, installation)

    const [cookie] = (await page.context().cookies()).filter((value) => value.name === SESSION_COOKIE)

    expect(cookie).toBeDefined()
    expect(cookie?.httpOnly).toBe(true)
    expect(cookie?.secure).toBe(true)
    expect(cookie?.sameSite).toBe('Strict')
  })

  test('survives a full page reload', async ({ page, installation }) => {
    await claim(page, installation)

    await page.reload()

    await expect(page.getByRole('navigation', { name: 'Sections' })).toBeVisible()
  })
})


test.describe('signing back in', () => {
  test('refuses a wrong password with one generic line', async ({ browser, page, installation }) => {
    await claim(page, installation)
    const stranger = await (await browser.newContext()).newPage()

    await signIn(stranger, installation, 'the-wrong-password')

    await expect(stranger.getByText('that password is not right')).toBeVisible()
    await expect(stranger.getByRole('navigation', { name: 'Sections' })).toHaveCount(0)
  })
})

test.describe('a page on another origin', () => {
  test('cannot change the password with a form post, even with the User signed in', async ({
    page,
    installation,
    foreign,
  }) => {
    await claim(page, installation)
    foreign.serve(`
      <form id="attack" method="POST" action="${installation.url}/api/auth/password"
            enctype="text/plain">
        <input name="currentPassword" value="${USER_PASSWORD}">
      </form>
      <script>document.getElementById('attack').submit()</script>
    `)

    await page.goto(foreign.url)
    await page.waitForURL(`${installation.url}/api/auth/password`)

    // A form post needs no preflight, so it does reach the server — and the
    // Origin check is what turns it away.
    await expect(page.locator('body')).toContainText('forbidden_origin')
    await page.goto(installation.url)
    await expect(page.getByRole('navigation', { name: 'Sections' })).toBeVisible()
  })

  test('cannot read the API with a credentialed fetch', async ({ page, installation, foreign }) => {
    await claim(page, installation)
    foreign.serve(`
      <p id="outcome">running</p>
      <script>
        fetch('${installation.url}/api/meta', { credentials: 'include' })
          .then((response) => { document.getElementById('outcome').textContent = 'reached:' + response.status })
          .catch(() => { document.getElementById('outcome').textContent = 'blocked' })
      </script>
    `)

    await page.goto(foreign.url)

    // No `Access-Control-Allow-Origin`, so the browser never hands the body
    // over — the service enables no credentialed cross-origin access at all.
    await expect(page.locator('#outcome')).toHaveText('blocked')
  })
})
